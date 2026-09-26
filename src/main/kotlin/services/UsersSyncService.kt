package com.viber.services

import com.viber.clients.RosterClient
import com.viber.models.GroupDetail
import com.viber.models.GroupSummary
import com.viber.models.GroupSyncStatus
import com.viber.models.ParticipantModel
import com.viber.models.TaskCollectionResult
import com.viber.models.UsersPage
import com.viber.models.UsersSyncAllResult
import com.viber.models.UsersSyncFailure
import com.viber.models.UsersSyncResult
import com.viber.models.UsersSyncStatus
import com.viber.models.ViberGroupMemberRow
import com.viber.models.ViberGroupRow
import com.viber.models.ViberUserRow
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.query.Columns
import io.github.jan.supabase.postgrest.query.Count
import io.github.jan.supabase.postgrest.query.Order
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import org.slf4j.LoggerFactory
import java.time.Instant

class SupabaseDisabledException :
    IllegalStateException("Supabase is not configured: set SUPABASE_URL and SUPABASE_SERVICE_KEY")

object UserRowMapper {

    private val PLACEHOLDER_NAMES = setOf("(без имени)", "(no name)")

    fun normalizePhone(raw: String?): String? {
        val value = raw?.trim().orEmpty()
        if (value.isEmpty() || value.startsWith("em", ignoreCase = true)) return null
        val digits = value.filter { it.isDigit() }
        return if (digits.length >= 7) "+$digits" else null
    }

    fun cleanMemberId(raw: String?): String? {
        val value = raw?.trim().orEmpty()
        return if (value.isEmpty() || value.startsWith("em:")) null else value
    }

    fun identityKey(memberId: String?, phone: String?): String? =
        memberId ?: phone?.let { "phone:${it.removePrefix("+")}" }

    private fun cleanName(raw: String?): String? {
        val value = raw?.trim().orEmpty()
        return if (value.isEmpty() || value in PLACEHOLDER_NAMES) null else value
    }

    fun toUserRow(participant: ParticipantModel, now: String): ViberUserRow? {
        if (participant.isSelf) return null
        val memberId = cleanMemberId(participant.memberId)
        val phone = normalizePhone(participant.number)
        val key = identityKey(memberId, phone) ?: return null
        val viberName = cleanName(participant.viberName)
        return ViberUserRow(
            identityKey = key,
            memberId = memberId,
            phone = phone,
            name = cleanName(participant.name) ?: viberName ?: cleanName(participant.contactName),
            viberName = viberName,
            isOnline = participant.isOnline,
            lastSeenAt = participant.lastSeen?.takeIf { it.isNotBlank() },
            updatedAt = now,
        )
    }

    fun groupKey(viberGroupId: String?, conversationId: Int): String =
        viberGroupId?.trim()?.takeIf { it.isNotEmpty() } ?: "conv:$conversationId"
}

class UsersSyncService(
    private val viberBotClient: RosterClient,
    private val supabase: () -> SupabaseClient?,
) {
    private val logger = LoggerFactory.getLogger(UsersSyncService::class.java)

    private val json = Json { ignoreUnknownKeys = true }

    private val batchSize = 500

    suspend fun syncGroup(conversationId: Int): UsersSyncResult {
        val group: GroupDetail = json.decodeFromString(viberBotClient.getGroup(conversationId))
        val participants: List<ParticipantModel> =
            json.decodeFromString(viberBotClient.getGroupParticipants(conversationId))
        return sync(group.name, conversationId, group.groupId, participants)
    }

    suspend fun syncAll(): UsersSyncAllResult {
        val client = supabase() ?: throw SupabaseDisabledException()
        val startedAt = Instant.now().toString()
        val groups: List<GroupSummary> = json.decodeFromString(viberBotClient.getGroups(includeAll = false))

        val synced = mutableListOf<UsersSyncResult>()
        val failed = mutableListOf<UsersSyncFailure>()
        for (group in groups) {
            try {
                synced += syncGroup(group.id)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                logger.warn("Bulk upload: group {} ({}) failed: {}", group.id, group.name, e.message)
                failed += UsersSyncFailure(group.id, group.name, e.message ?: e::class.simpleName.orEmpty())
            }
        }

        val usersInDatabase = runCatching {
            client.from("viber_users").select(Columns.list("id")) {
                count(Count.EXACT)
                limit(1)
            }.countOrNull()?.toInt()
        }.getOrNull()

        val upserted = synced.sumOf { it.usersUpserted }
        return UsersSyncAllResult(
            success = failed.isEmpty(),
            message = if (failed.isEmpty()) {
                "Загружено групп: ${synced.size} из ${groups.size}"
            } else {
                "Загружено групп: ${synced.size} из ${groups.size}, с ошибкой: ${failed.size}"
            },
            groupsTotal = groups.size,
            groups = synced,
            failed = failed,
            usersUpserted = upserted,
            usersInDatabase = usersInDatabase,
            syncedAt = startedAt,
        )
    }

    suspend fun syncTask(taskId: String): UsersSyncResult {
        // Only `status` and `result` are read. This slim view (with
        // ignoreUnknownKeys) skips stepHistory, whose progress map holds numbers
        // under keys the full TaskDetail types as String — those fail to parse.
        val task: TaskSyncView = json.decodeFromString(viberBotClient.getTask(taskId))
        val result = task.result
            ?: throw IllegalArgumentException("Задача $taskId ещё не завершена (статус ${task.status})")
        val participants: List<ParticipantModel> =
            json.decodeFromString(viberBotClient.getTaskParticipants(taskId))
        return sync(result.group, result.conversationId, result.groupId, participants)
    }

    @Serializable
    private data class TaskSyncView(
        val status: String,
        val result: TaskCollectionResult? = null,
    )

    private suspend fun sync(
        groupName: String?,
        conversationId: Int,
        viberGroupId: String?,
        participants: List<ParticipantModel>,
    ): UsersSyncResult {
        val client = supabase() ?: throw SupabaseDisabledException()
        val now = Instant.now().toString()

        val mapped = participants
            .mapNotNull { p -> UserRowMapper.toUserRow(p, now)?.let { row -> row to p } }
            .distinctBy { (row, _) -> row.identityKey }
        val rows = mapped.map { (row, _) -> row }
        val skipped = participants.size - rows.size

        val groupRow = client.from("viber_groups").upsert(
            ViberGroupRow(
                groupKey = UserRowMapper.groupKey(viberGroupId, conversationId),
                viberGroupId = viberGroupId,
                conversationId = conversationId,
                name = groupName,
                participantCount = rows.size,
                lastSyncedAt = now,
                updatedAt = now,
            ),
        ) {
            onConflict = "group_key"
            select()
        }.decodeSingle<ViberGroupRow>()
        val groupId = groupRow.id ?: error("Supabase returned no id for the group row")

        val userIds = HashMap<String, Long>(rows.size)
        for (batch in rows.chunked(batchSize)) {
            val saved = client.from("viber_users").upsert(batch) {
                onConflict = "identity_key"
                select()
            }.decodeList<ViberUserRow>()
            for (row in saved) {
                val id = row.id ?: continue
                userIds[row.identityKey] = id
            }
        }

        val memberRows = mapped.mapNotNull { (row, participant) ->
            val userId = userIds[row.identityKey] ?: return@mapNotNull null
            ViberGroupMemberRow(
                groupId = groupId,
                userId = userId,
                role = participant.groupRole,
                active = participant.active,
                syncedAt = now,
            )
        }
        for (batch in memberRows.chunked(batchSize)) {
            client.from("viber_group_members").upsert(batch) { onConflict = "group_id,user_id" }
        }

        val deactivated = client.from("viber_group_members").update(
            { set("active", false) },
        ) {
            select()
            filter {
                eq("group_id", groupId)
                eq("active", true)
                lt("synced_at", now)
            }
        }.decodeList<ViberGroupMemberRow>().size

        logger.info(
            "Synced group {} (conversation {}) to Supabase: {} users, {} skipped, {} deactivated",
            groupName, conversationId, rows.size, skipped, deactivated,
        )

        return UsersSyncResult(
            success = true,
            message = "Группа синхронизирована с Supabase",
            group = groupName,
            conversationId = conversationId,
            groupId = viberGroupId,
            received = participants.size,
            usersUpserted = rows.size,
            skipped = skipped,
            deactivated = deactivated,
            syncedAt = now,
        )
    }

    suspend fun syncStatus(conversationId: Int? = null): UsersSyncStatus {
        val checkedAt = Instant.now().toString()
        val client = supabase() ?: return UsersSyncStatus(
            configured = false,
            reachable = false,
            message = "Supabase не настроен: задайте SUPABASE_URL и SUPABASE_SERVICE_KEY",
            checkedAt = checkedAt,
        )

        return try {
            val groups = client.from("viber_groups").select(Columns.ALL) {
                conversationId?.let { id -> filter { eq("conversation_id", id) } }
                order("last_synced_at", Order.DESCENDING)
            }.decodeList<ViberGroupRow>()

            val groupStatuses = groups.map { group ->
                val id = group.id
                GroupSyncStatus(
                    groupKey = group.groupKey,
                    conversationId = group.conversationId,
                    name = group.name,
                    participantCount = group.participantCount,
                    activeMembers = if (conversationId != null) id?.let { countMembers(client, it, active = true) } else null,
                    inactiveMembers = if (conversationId != null) id?.let { countMembers(client, it, active = false) } else null,
                    lastSyncedAt = group.lastSyncedAt,
                )
            }

            val usersTotal = countRows(client, "viber_users")
            val membersTotal = countRows(client, "viber_group_members")
            val groupsTotal = if (conversationId == null) groups.size else countRows(client, "viber_groups")

            val message = when {
                conversationId != null && groups.isEmpty() ->
                    "Группа $conversationId ещё не записывалась в Supabase"
                usersTotal == 0 -> "Supabase доступен, но пользователей в нём пока нет"
                else -> "Supabase доступен, записи есть"
            }

            UsersSyncStatus(
                configured = true,
                reachable = true,
                message = message,
                usersTotal = usersTotal,
                groupsTotal = groupsTotal,
                membersTotal = membersTotal,
                lastSyncedAt = groups.mapNotNull { it.lastSyncedAt }.maxOrNull(),
                groups = groupStatuses,
                checkedAt = checkedAt,
            )
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            logger.warn("Supabase status check failed: {}", e.message)
            UsersSyncStatus(
                configured = true,
                reachable = false,
                message = "Supabase недоступен: ${e.message ?: e::class.simpleName}",
                checkedAt = checkedAt,
            )
        }
    }

    private suspend fun countRows(client: SupabaseClient, table: String): Int? =
        client.from(table).select(Columns.list("*")) {
            count(Count.EXACT)
            limit(1)
        }.countOrNull()?.toInt()

    private suspend fun countMembers(client: SupabaseClient, groupId: Long, active: Boolean): Int? =
        client.from("viber_group_members").select(Columns.list("group_id")) {
            count(Count.EXACT)
            limit(1)
            filter {
                eq("group_id", groupId)
                eq("active", active)
            }
        }.countOrNull()?.toInt()

    suspend fun listUsers(limit: Int, offset: Int, phone: String?, name: String?): UsersPage {
        val client = supabase() ?: throw SupabaseDisabledException()
        val safeLimit = limit.coerceIn(1, 1000)
        val safeOffset = offset.coerceAtLeast(0)

        val result = client.from("viber_users").select(Columns.ALL) {
            count(Count.EXACT)
            filter {
                phone?.takeIf { it.isNotBlank() }?.let { like("phone", "%${it.filter(Char::isDigit)}%") }
                name?.takeIf { it.isNotBlank() }?.let { ilike("name", "%$it%") }
            }
            order("updated_at", Order.DESCENDING)
            range(safeOffset.toLong(), (safeOffset + safeLimit - 1).toLong())
        }

        return UsersPage(
            total = result.countOrNull()?.toInt(),
            limit = safeLimit,
            offset = safeOffset,
            items = result.decodeList<ViberUserRow>(),
        )
    }

    @Serializable
    private data class SupabaseGroupMemberJoin(
        val role: Int? = null,
        val active: Boolean = true,
        @SerialName("viber_users")
        val user: ViberUserRow? = null,
    )

    suspend fun getGroupUsers(targetId: String): List<ParticipantModel> {
        val client = supabase() ?: throw SupabaseDisabledException()
        val convId = targetId.toIntOrNull()

        var group: ViberGroupRow? = null
        if (convId != null) {
            group = client.from("viber_groups").select(Columns.ALL) {
                filter { eq("conversation_id", convId) }
                limit(1)
            }.decodeList<ViberGroupRow>().firstOrNull()
        }
        if (group == null) {
            group = client.from("viber_groups").select(Columns.ALL) {
                filter { eq("group_key", targetId) }
                limit(1)
            }.decodeList<ViberGroupRow>().firstOrNull()
        }
        if (group == null) {
            group = client.from("viber_groups").select(Columns.ALL) {
                filter { eq("viber_group_id", targetId) }
                limit(1)
            }.decodeList<ViberGroupRow>().firstOrNull()
        }

        val groupId = group?.id ?: return emptyList()

        val allMembers = mutableListOf<SupabaseGroupMemberJoin>()
        var offset = 0L
        val pageSize = 1000L
        while (true) {
            val batch = client.from("viber_group_members").select(Columns.raw("role, active, viber_users(*)")) {
                filter { eq("group_id", groupId) }
                order("user_id", Order.ASCENDING)
                range(offset, offset + pageSize - 1)
            }.decodeList<SupabaseGroupMemberJoin>()
            allMembers.addAll(batch)
            if (batch.size < pageSize) break
            offset += pageSize
        }

        return allMembers.mapIndexedNotNull { idx, item ->
            val user = item.user ?: return@mapIndexedNotNull null
            val rawNumber = user.phone ?: user.memberId?.let { "em:$it" } ?: ""
            val role = item.role
            val roleLabel = when (role) {
                1 -> "superadmin"
                2 -> "admin"
                else -> "member"
            }
            ParticipantModel(
                id = (user.id ?: (idx + 1).toLong()).toInt(),
                memberId = user.memberId ?: user.identityKey,
                number = rawNumber,
                name = user.name,
                contactName = null,
                viberName = user.viberName,
                groupRole = role,
                roleLabel = roleLabel,
                active = item.active,
                isSelf = false,
                isOnline = user.isOnline,
                lastSeen = user.lastSeenAt,
            )
        }
    }
}

