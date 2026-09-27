package com.viber.services

import com.viber.models.MonitoredMessageEvent
import com.viber.models.ViberGroupRow
import com.viber.models.ViberMonitoredMessageRow
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.postgrest.from
import java.time.Instant

interface MonitoredMessageRepository : ViberGroupRepository {
    suspend fun upsertMessage(message: ViberMonitoredMessageRow)
}

class SupabaseMonitoredMessageRepository(
    private val client: SupabaseClient,
) : MonitoredMessageRepository {
    private val groups = SupabaseViberGroupRepository(client)

    override suspend fun find(instanceId: String, conversationId: Int): ViberGroupRow? =
        groups.find(instanceId, conversationId)

    override suspend fun insertPlaceholderIfAbsent(group: ViberGroupRow): ViberGroupRow =
        groups.insertPlaceholderIfAbsent(group)

    override suspend fun upsertRosterGroup(group: ViberGroupRow): ViberGroupRow =
        groups.upsertRosterGroup(group)

    override suspend fun upsertMessage(message: ViberMonitoredMessageRow) {
        client.from("viber_monitored_messages").upsert(message) {
            onConflict = "instance_id,conversation_id,source_key"
        }
    }
}

class MonitoredMessagePersistenceService(
    private val repository: MonitoredMessageRepository,
    private val now: () -> String = { Instant.now().toString() },
) {
    private val groups = ViberGroupPersistenceService(repository, now)

    suspend fun persist(event: MonitoredMessageEvent): ViberMonitoredMessageRow {
        require(event.instanceId.isNotBlank()) { "Viber instance id must not be blank" }
        require(event.phoneSource in PHONE_SOURCES) {
            "Unsupported monitored message phone source: ${event.phoneSource}"
        }

        val timestamp = now()
        val group = groups.resolveForMessage(
            event.instanceId,
            event.conversationId,
            event.conversationName,
            event.viberGroupId,
        )
        val groupId = requireNotNull(group.id) { "Supabase returned no id for the message group" }
        val token = event.token?.trim()?.takeUnless { it.isEmpty() || it == "0" }
        val row = ViberMonitoredMessageRow(
            groupId = groupId,
            instanceId = event.instanceId,
            conversationId = event.conversationId,
            sourceKey = token?.let { "token:$it" } ?: "row:${event.id}",
            sourceMessageId = event.id,
            viberToken = token,
            senderName = event.senderName,
            sentAt = event.date,
            phone = event.attachedPhone,
            phoneSource = event.phoneSource,
            content = event.body,
            updatedAt = timestamp,
        )
        repository.upsertMessage(row)
        return row
    }

    private companion object {
        val PHONE_SOURCES = setOf("message_text", "viber_profile", "none")
    }
}
