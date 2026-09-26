package com.viber.models

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable


@Serializable
data class CreateCampaignRequest(
    val name: String? = null,

    val conversationIds: List<Int>,

    val messages: List<String>,

    val intervalMs: Long,

    val minIntervalPerChatMs: Long? = null,

    val rotation: String? = null,

    val loop: Boolean? = null,

    val activeFrom: String? = null,

    val activeTo: String? = null,

    /** Names the panel shows for [conversationIds]; the bot reads the real ones off the device. */
    val groupNames: List<String>? = null,
)


@Serializable
data class UpdateCampaignRequest(
    val name: String? = null,
    val conversationIds: List<Int>? = null,
    val messages: List<String>? = null,
    val intervalMs: Long? = null,
    val minIntervalPerChatMs: Long? = null,
    val rotation: String? = null,
    val loop: Boolean? = null,
    val activeFrom: String? = null,
    val activeTo: String? = null,
    /** Names the panel shows for [conversationIds]; the bot reads the real ones off the device. */
    val groupNames: List<String>? = null,
)


@Serializable
data class ChatRotationState(
    val conversationId: Int,
    val sendCount: Int,
    val lastMessageIndex: Int? = null,
)


@Serializable
data class CampaignGroup(
    val conversationId: Int,
    val name: String? = null,
)

@Serializable
data class Campaign(
    val id: String,
    val name: String,
    val groups: List<CampaignGroup>,
    val messages: List<String>,
    val intervalMs: Long,
    val minIntervalPerChatMs: Long,
    val rotation: String,
    val loop: Boolean,
    val activeFrom: String? = null,
    val activeTo: String? = null,
    val status: String,
    val nextGroupIndex: Int,
    val rotationState: List<ChatRotationState> = emptyList(),
    val sentCount: Int,
    val failedCount: Int,
    val lastError: String? = null,
    val createdAt: String,
    val updatedAt: String,
    val startedAt: String? = null,
    val stoppedAt: String? = null,
)


@Serializable
data class BroadcastStatus(
    val isRunning: Boolean,
    val campaign: Campaign? = null,
)


@Serializable
data class SendHistoryEntry(
    val id: String,
    val campaignId: String,
    val conversationId: Int,
    val conversationName: String? = null,
    val messageIndex: Int,
    val text: String,
    /** sent или failed. */
    val status: String,
    val error: String? = null,
    val sentAt: String,
)


@Serializable
data class CampaignDeletedResponse(
    @SerialName("deleted") val deleted: Boolean,
)
