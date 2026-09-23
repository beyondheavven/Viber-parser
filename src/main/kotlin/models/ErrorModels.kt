package com.viber.models

import kotlinx.serialization.Serializable

enum class ErrorType{
    BOT_ERROR,
    RPC_TIMEOUT,
    API_INTERNAL_ERROR,
    VALIDATION_ERROR,
    DEVICE_BUSY,
    NOT_FOUND
}

@Serializable
data class ErrorResponse(
    val success: Boolean,
    val errorType: ErrorType,
    val message: String,
    val path: String,
    val timestamp: String
)