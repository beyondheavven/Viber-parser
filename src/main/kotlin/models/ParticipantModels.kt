package com.viber.models

import kotlinx.serialization.Serializable


@Serializable
data class CollectParticipantsRequest(
    val group: String,

    val allowPartial: Boolean = false,

    val restartApp: Boolean = true,

    val idleTimeoutMs: Int = 15_000,

    val numbersSyncTimeoutMs: Int = 45_000,

    val syncLiveDbAfter: Boolean = false,

    val fetchOnlineStatus: Boolean = true,
)

@Serializable
data class QueryOnlineStatusRequest(

    val memberIds: List<String> = emptyList(),

    val phoneNumbers: List<String> = emptyList(),
)

@Serializable
data class ParticipantModel(

    val id: Int,

    val memberId: String? = null,

    val number: String? = null,

    val name: String? = null,

    val contactName: String? = null,

    val viberName: String? = null,

    val groupRole: Int? = null,

    val roleLabel: String,

    val active: Boolean,

    val isSelf: Boolean,

    val isOnline: Boolean? = null,

    val lastSeen: String? = null,

)