package com.viber.models

import kotlinx.serialization.Serializable


@Serializable
data class ViberStartRequest(
    val clearData: Boolean = false,
    val waitForLogin: Boolean = false,
)

@Serializable
data class ViberStartResponse(
    val success: Boolean,
    val message: String,
    val pid: Int? = null,
)

@Serializable
data class ViberStatusResponse(
    val isRunning: Boolean,
    val pid: Int? = null,
)