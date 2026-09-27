package com.viber.models

import kotlinx.serialization.Serializable


@Serializable
data class CollectParticipantsRequest(
    val group: String,

    val allowPartial: Boolean = false,

    val restartApp: Boolean = true,

    val idleTimeoutMs: Int = 15_000,

    val numbersSyncTimeoutMs: Int = 0,

    val syncLiveDbAfter: Boolean = false,

    val fetchOnlineStatus: Boolean = true,

    val twoPass: Boolean = true,
    val passesCount: Int? = null,

    // Paging knobs the OnixData panel sends. The collector always reads the
    // whole roster fresh from Viber, so there is nothing for them to tune.
    val pageLimit: Int? = null,

    val scrollPages: Int? = null,

    val forceRefresh: Boolean? = null,

    /** Emulator instance the panel addresses; this API drives a single emulator. */
    val deviceId: String? = null,
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

@Serializable
data class OnlineStatusItem(
    val memberId: String,

    val phoneNumber: String? = null,

    val isOnline: Boolean,

    val lastSeen: String? = null
)