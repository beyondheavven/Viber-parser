package com.viber.models

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class MonitoredMessageEvent(
    val id: Long,
    val instanceId: String,
    val conversationId: Int,
    val conversationName: String? = null,
    val viberGroupId: String? = null,
    val token: String? = null,
    val date: String,
    val body: String? = null,
    val senderName: String? = null,
    val attachedPhone: String? = null,
    val phoneSource: String,
)

@Serializable
data class ViberMonitoredMessageRow(
    val id: Long? = null,

    @SerialName("group_id")
    val groupId: Long,

    @SerialName("instance_id")
    val instanceId: String,

    @SerialName("conversation_id")
    val conversationId: Int,

    @SerialName("source_key")
    val sourceKey: String,

    @SerialName("source_message_id")
    val sourceMessageId: Long,

    @SerialName("viber_token")
    val viberToken: String? = null,

    @SerialName("sender_name")
    val senderName: String? = null,

    @SerialName("sent_at")
    val sentAt: String,

    val phone: String? = null,

    @SerialName("phone_source")
    val phoneSource: String,

    val content: String? = null,

    @SerialName("created_at")
    val createdAt: String? = null,

    @SerialName("updated_at")
    val updatedAt: String,
)

@Serializable
data class MonitoredMessageResponse(
    val id: Long,
    val deviceId: String? = null,
    val conversationId: Int,
    val conversationName: String? = null,
    val token: String? = null,
    val date: String,
    val body: String? = null,
    val senderId: Long? = null,
    val senderName: String? = null,
    val senderMemberId: String? = null,
    val outgoing: Boolean = false,
    val hasPhoneInText: Boolean = false,
    val attachedPhone: String? = null,
    val phoneSource: String = "none",
    val allFoundPhones: List<String>? = null,
    val hasMedia: Boolean = false,
    val mediaUris: List<String>? = null,
    val mergedMessageIds: List<Long>? = null,
)

@Serializable
data class SupabaseGroupSummary(
    val name: String? = null,
    @SerialName("group_key")
    val groupKey: String? = null,
)

@Serializable
data class SupabaseMonitoredMessageWithGroup(
    val id: Long,
    @SerialName("group_id")
    val groupId: Long,
    @SerialName("instance_id")
    val instanceId: String,
    @SerialName("conversation_id")
    val conversationId: Int,
    @SerialName("source_key")
    val sourceKey: String,
    @SerialName("source_message_id")
    val sourceMessageId: Long,
    @SerialName("viber_token")
    val viberToken: String? = null,
    @SerialName("sender_name")
    val senderName: String? = null,
    @SerialName("sent_at")
    val sentAt: String,
    val phone: String? = null,
    @SerialName("phone_source")
    val phoneSource: String = "none",
    val content: String? = null,
    @SerialName("created_at")
    val createdAt: String? = null,
    @SerialName("updated_at")
    val updatedAt: String? = null,
    @SerialName("viber_groups")
    val group: SupabaseGroupSummary? = null,
) {
    fun toResponse(): MonitoredMessageResponse =
        MonitoredMessageResponse(
            id = sourceMessageId,
            deviceId = instanceId,
            conversationId = conversationId,
            conversationName = group?.name,
            token = viberToken,
            date = sentAt,
            body = content,
            senderName = senderName,
            attachedPhone = phone,
            phoneSource = phoneSource,
            hasPhoneInText = phoneSource == "message_text",
            outgoing = false,
            hasMedia = false,
        )
}

@Serializable
data class MonitoredExportEnvelope(
    val exportedAt: String,
    val count: Int,
    val messages: List<MonitoredMessageResponse>,
)
