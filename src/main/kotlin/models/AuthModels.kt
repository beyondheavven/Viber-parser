package com.viber.models

import kotlinx.serialization.Serializable


@Serializable
data class LoginRequest(
    val phoneNumber: String,
    val countryCode: String
)

@Serializable
data class LoginResponse(
    val success: Boolean,
    val message: String,
    val data: String? = null
)

@Serializable
data class CodeRequest(
    val code: String
)

@Serializable
data class ErrorResponse(
    val error: String,
    val message: String,
)