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
