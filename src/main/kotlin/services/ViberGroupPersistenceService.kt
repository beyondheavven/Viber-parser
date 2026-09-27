package com.viber.services

import com.viber.models.ViberGroupRow
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.query.Columns
import java.time.Instant

interface ViberGroupRepository {
    suspend fun find(instanceId: String, conversationId: Int): ViberGroupRow?
    suspend fun insertPlaceholderIfAbsent(group: ViberGroupRow): ViberGroupRow
    suspend fun upsertRosterGroup(group: ViberGroupRow): ViberGroupRow
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
            limit(1)
        }.decodeList<ViberGroupRow>().firstOrNull()

    override suspend fun insertPlaceholderIfAbsent(group: ViberGroupRow): ViberGroupRow {
        client.from("viber_groups").upsert(group) {
            onConflict = "instance_id,conversation_id"
            ignoreDuplicates = true
        }
        return find(group.instanceId, requireNotNull(group.conversationId))
            ?: error("Supabase returned no row for the message group")
    }

    override suspend fun upsertRosterGroup(group: ViberGroupRow): ViberGroupRow =
        client.from("viber_groups").upsert(group) {
            onConflict = "instance_id,conversation_id"
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
        repository.find(instanceId, conversationId)?.let { return it }

        val timestamp = now()
        val stableGroupId = viberGroupId?.trim()?.takeIf(String::isNotEmpty)
        return repository.insertPlaceholderIfAbsent(
            ViberGroupRow(
                instanceId = instanceId,
                groupKey = stableGroupId ?: "conv:$conversationId",
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
        return repository.upsertRosterGroup(
            ViberGroupRow(
                instanceId = instanceId,
                groupKey = UserRowMapper.groupKey(viberGroupId, conversationId),
                viberGroupId = viberGroupId,
                conversationId = conversationId,
                name = name,
                participantCount = participantCount,
                lastSyncedAt = timestamp,
                updatedAt = timestamp,
            ),
        )
    }
}
