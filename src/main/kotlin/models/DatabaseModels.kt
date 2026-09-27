package com.viber.models

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class DatabaseStats(
    val conversationsCount: Int,

    val participantsCount: Int,

    val undecodedParticipantsCount: Int,

    val messagesCount: Int
)

@Serializable
data class SyncResult(
    val success: Boolean,

    val message: String,

    val timestamp: String,

    val stats: DatabaseStats
)

@Serializable
data class DecodeRequest(
    val dryRun: Boolean = false,

    val limit: Int? = null,

    val restartApp: Boolean = true,

    val waitForSyncSeconds: Int = 10,

    val includeSelf: Boolean = false,
)

@Serializable
data class DecodedItem(
    val id: Int,

    val name: String? = null,

    val oldMemberId: String? = null,

    val newMemberId: String
)

@Serializable
data class DecodeResult(
    val success: Boolean,

    val message: String,

    val dryRun: Boolean,

    val totalRows: Int,

    val undecodedFound: Int,

    val decodedFound: Int,

    val errorsCount: Int,

    val sampleDecoded: List<DecodedItem>? = null,

    val restartedApp: Boolean? = null
)

@Serializable
data class SupabaseGroupMemberJoin(
    val role: Int? = null,
    val active: Boolean = true,
    @SerialName("viber_users")
    val user: ViberUserRow? = null,
)