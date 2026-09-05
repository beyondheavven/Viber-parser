package com.viber.dto

import kotlinx.serialization.Serializable


@Serializable
data class DecodedParticipantResponse(
    val infoId: Long,
    val name: String?,
    val newMemberId: String,
    val memberIdChanged: Boolean,
    val participantType: Int,
    val safeContact: Int,
    val previousMemberId: String?,
    val previousNumber: String?,
    val previousParticipantType: Int?,
)

@Serializable
data class SkippedParticipantResponse(val infoId: Long, val reason: String)

@Serializable
data class InvalidParticipantResponse(val infoId: Long, val encryptedMemberId: String?, val error: String)

@Serializable
data class DecodeParticipantsResponse(
    val dryRun: Boolean,
    val read: Int,
    val decodedCount: Int,
    val updated: Int,
    val changedRows: Int?,
    val skippedCount: Int,
    val invalidCount: Int,
    val backupPath: String?,
    val decoded: List<DecodedParticipantResponse>,
    val skipped: List<SkippedParticipantResponse>,
    val invalid: List<InvalidParticipantResponse>,
)
