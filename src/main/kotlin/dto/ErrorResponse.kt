package com.viber.dto

import kotlinx.serialization.Serializable

@Serializable
data class ErrorResponse(
    val error: String
)
