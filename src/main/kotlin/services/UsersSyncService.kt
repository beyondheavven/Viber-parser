package com.viber.services

import com.viber.clients.RosterClient
import com.viber.models.GroupDetail
import com.viber.models.ParticipantModel
import com.viber.models.TaskDetail
import com.viber.models.UsersPage
import com.viber.models.UsersSyncResult
import com.viber.models.ViberGroupMemberRow
import com.viber.models.ViberGroupRow
import com.viber.models.ViberUserRow
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.query.Columns
import io.github.jan.supabase.postgrest.query.Count
import io.github.jan.supabase.postgrest.query.Order
import kotlinx.serialization.json.Json
import org.slf4j.LoggerFactory
import java.time.Instant

/** Raised when a sync is requested while `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` are unset. */
class SupabaseDisabledException :
    IllegalStateException("Supabase is not configured: set SUPABASE_URL and SUPABASE_SERVICE_KEY")

/**
 * Turns the bot's participant records into rows of the Supabase user base.
 *
 * Pure functions, kept apart from the service so the field rules can be unit
 * tested without a Supabase client.
 */
object UserRowMapper {

    /** Placeholder names the bot emits when Viber has none. */
    private val PLACEHOLDER_NAMES = setOf("(без имени)", "(no name)")

    /**
     * Normalises a phone to E.164 digits with a leading plus, or null when the
     * bot passed a placeholder ("em:…", "Ожидает дешифровки", too short).
     */
    fun normalizePhone(raw: String?): String? {
        val value = raw?.trim().orEmpty()
        if (value.isEmpty() || value.startsWith("em", ignoreCase = true)) return null
        val digits = value.filter { it.isDigit() }
        // Anything shorter than a subscriber number is a placeholder, not an identity.
        return if (digits.length >= 7) "+$digits" else null
    }

    /** A decoded Viber member id, or null while it is still an `em:` blob. */
    fun cleanMemberId(raw: String?): String? {
        val value = raw?.trim().orEmpty()
        return if (value.isEmpty() || value.startsWith("em:")) null else value
    }

    /** Stable key rows are upserted on: member id first, phone as a fallback. */
    fun identityKey(memberId: String?, phone: String?): String? =
        memberId ?: phone?.let { "phone:${it.removePrefix("+")}" }

    private fun cleanName(raw: String?): String? {
        val value = raw?.trim().orEmpty()
        return if (value.isEmpty() || value in PLACEHOLDER_NAMES) null else value
    }

    /**
     * Maps one participant, or returns null for rows that have no place in the
     * user base: the automated account itself, and members with neither a
     * decoded member id nor a phone (nothing to key them on).
     */
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

    /** `groupKey` of a conversation: the 64-bit Viber id, else its local row id. */
    fun groupKey(viberGroupId: String?, conversationId: Int): String =
        viberGroupId?.trim()?.takeIf { it.isNotEmpty() } ?: "conv:$conversationId"
}

/**
 * Pushes a group's roster from the bot into the Supabase user base.
 *
 * The client is looked up per call because the Supabase module is configured
 * after routing; holding a reference at construction time would capture null.
 */
class UsersSyncService(
    private val viberBotClient: RosterClient,
    private val supabase: () -> SupabaseClient?,
) {
    private val logger = LoggerFactory.getLogger(UsersSyncService::class.java)

    private val json = Json { ignoreUnknownKeys = true }

    /** Supabase rejects requests past a few MB; 500 rows keeps well under that. */
    private val batchSize = 500

    /** Syncs a group straight from the bot's SQLite snapshot. */
    suspend fun syncGroup(conversationId: Int): UsersSyncResult {
        val group: GroupDetail = json.decodeFromString(viberBotClient.getGroup(conversationId))
        val participants: List<ParticipantModel> =
            json.decodeFromString(viberBotClient.getGroupParticipants(conversationId))
        return sync(group.name, conversationId, group.groupId, participants)
    }

    /** Syncs the roster a finished collect task produced (with online status). */
    suspend fun syncTask(taskId: String): UsersSyncResult {
        val task: TaskDetail = json.decodeFromString(viberBotClient.getTask(taskId))
        val result = task.result
            ?: throw IllegalArgumentException("Задача $taskId ещё не завершена (статус ${task.status})")
        val participants: List<ParticipantModel> =
            json.decodeFromString(viberBotClient.getTaskParticipants(taskId))
        return sync(result.group, result.conversationId, result.groupId, participants)
    }

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
            // The same person can appear twice before the bot's dedup runs; the
            // upsert would fail on a duplicate key inside one batch.
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

        // Whoever was not touched by this sync has left the group.
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

    /** Reads users back, newest update first, optionally filtered by phone or name. */
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
}
