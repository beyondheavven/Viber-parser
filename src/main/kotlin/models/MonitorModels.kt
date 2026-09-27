package com.viber.models

import kotlinx.serialization.Serializable

@Serializable
data class MonitoredGroup(
    val conversationId: Int,

    val name: String? = null,

    val enabled: Boolean,

    val lastMessageId: Int
)

@Serializable
data class StartMonitorRequest(
    val conversationId: Int? = null,

    val pollIntervalMs: Int = 2500,

    val fromLatest: Boolean? = null,

    val startFromId: Int? = null,

    /** Emulator instance the panel addresses; this API drives a single emulator. */
    val deviceId: String? = null,
)

@Serializable
data class EnableMonitorGroupRequest(
    val fromLatest: Boolean? = null,

    /**
     * The group's global Viber id (`conversations.group_id`). The panel's
     * local id may come from another account; when this is set, the group is
     * looked up by it on this emulator instead.
     */
    val groupKey: String? = null,

    /** Emulator instance the panel addresses; this API drives a single emulator. */
    val deviceId: String? = null,
)

@Serializable
data class MonitorStatus(
    val isRunning: Boolean,

    val conversationId: Int? = null,

    val groups: List<MonitoredGroup>,

    val liveWatch: Boolean,

    val pollIntervalMs: Int,

    val lastPollAt: String? = null,

    val lastProcessedMessageId: Int,

    val processedMessagesCount: Int,

    val phonesFromTextCount: Int,

    val phonesFromViberCount: Int
)