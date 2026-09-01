package com.viber.dto

import kotlinx.serialization.Serializable

@Serializable
data class DecodeParticipantsRequest(
    val dryRun: Boolean = false,
    val includeSelf: Boolean = false,
    val limit: Int? = null,
    val restartApp: Boolean = true,
)
