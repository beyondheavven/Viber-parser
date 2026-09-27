package com.viber.services

import com.viber.models.ViberGroupRow
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.query.Columns
import io.github.jan.supabase.postgrest.query.Order
import java.time.Instant

interface ViberGroupRepository {
    suspend fun find(instanceId: String, conversationId: Int): ViberGroupRow?
    suspend fun findByGroupKey(instanceId: String, groupKey: String): ViberGroupRow? = null
    suspend fun insertPlaceholderIfAbsent(group: ViberGroupRow): ViberGroupRow
    suspend fun upsertRosterGroup(group: ViberGroupRow): ViberGroupRow
    suspend fun updateGroup(id: Long, group: ViberGroupRow): ViberGroupRow = group
}

class SupabaseViberGroupRepository(
    private val client: SupabaseClient,
) : ViberGroupRepository {
    override suspend fun find(instanceId: String, conversationId: Int): ViberGroupRow? =
        client.from("viber_groups").select(Columns.ALL) {
            filter {
                eq("instance_id", instanceId)
                eq("conversation_id", conversationId)
            }
            order("last_synced_at", Order.DESCENDING)
            limit(1)
        }.decodeList<ViberGroupRow>().firstOrNull()

    override suspend fun findByGroupKey(instanceId: String, groupKey: String): ViberGroupRow? =
        client.from("viber_groups").select(Columns.ALL) {
            filter {
                eq("instance_id", instanceId)
                eq("group_key", groupKey)
            }
            limit(1)
        }.decodeList<ViberGroupRow>().firstOrNull()

    override suspend fun insertPlaceholderIfAbsent(group: ViberGroupRow): ViberGroupRow {
        client.from("viber_groups").upsert(group) {
            onConflict = "instance_id,group_key"
            ignoreDuplicates = true
        }
        return findByGroupKey(group.instanceId, group.groupKey)
            ?: find(group.instanceId, requireNotNull(group.conversationId))
            ?: error("Supabase returned no row for the message group")
    }

    override suspend fun upsertRosterGroup(group: ViberGroupRow): ViberGroupRow =
        client.from("viber_groups").upsert(group) {
            onConflict = "instance_id,group_key"
            select()
        }.decodeSingle()

    override suspend fun updateGroup(id: Long, group: ViberGroupRow): ViberGroupRow =
        client.from("viber_groups").update(group) {
            filter { eq("id", id) }
            select()
        }.decodeSingle()
}

class ViberGroupPersistenceService(
    private val repository: ViberGroupRepository,
    private val now: () -> String = { Instant.now().toString() },
) {
    suspend fun resolveForMessage(
        instanceId: String,
        conversationId: Int,
        name: String?,
        viberGroupId: String? = null,
    ): ViberGroupRow {
        require(instanceId.isNotBlank()) { "Viber instance id must not be blank" }
        val stableGroupId = viberGroupId?.trim()?.takeIf(String::isNotEmpty)
        val expectedGroupKey = stableGroupId ?: "conv:$conversationId"

        val existing = repository.findByGroupKey(instanceId, expectedGroupKey)
            ?: repository.find(instanceId, conversationId)

        if (existing != null) {
            return existing
        }

        val timestamp = now()
        return repository.insertPlaceholderIfAbsent(
            ViberGroupRow(
                instanceId = instanceId,
                groupKey = expectedGroupKey,
                viberGroupId = stableGroupId,
                conversationId = conversationId,
                name = name,
                participantCount = 0,
                lastSyncedAt = timestamp,
                updatedAt = timestamp,
            ),
        )
    }

    suspend fun promoteFromRoster(
        instanceId: String,
        conversationId: Int,
        viberGroupId: String?,
        name: String?,
        participantCount: Int,
    ): ViberGroupRow {
        require(instanceId.isNotBlank()) { "Viber instance id must not be blank" }
        val timestamp = now()
        val targetGroupKey = UserRowMapper.groupKey(viberGroupId, conversationId)
        val stableGroupId = viberGroupId?.trim()?.takeIf(String::isNotEmpty)

        val placeholder = if (stableGroupId != null) {
            repository.findByGroupKey(instanceId, "conv:$conversationId")
                ?: repository.find(instanceId, conversationId)?.takeIf { it.groupKey == "conv:$conversationId" }
        } else null

        val targetRow = ViberGroupRow(
            id = placeholder?.id,
            instanceId = instanceId,
            groupKey = targetGroupKey,
            viberGroupId = stableGroupId,
            conversationId = conversationId,
            name = name,
            participantCount = participantCount,
            lastSyncedAt = timestamp,
            updatedAt = timestamp,
        )

        return if (placeholder?.id != null) {
            repository.updateGroup(placeholder.id, targetRow)
        } else {
            repository.upsertRosterGroup(targetRow)
        }
    }
}
