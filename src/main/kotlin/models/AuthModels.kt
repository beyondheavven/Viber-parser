package com.viber.models

import kotlinx.serialization.Serializable


@Serializable
data class LoginRequest(
    val phoneNumber: String? = null,
    val countryName: String? = null,
    val countryCode: String? = null
)

@Serializable
data class LoginResponse(
    val success: Boolean,
    val message: String,
    val data: String? = null,
    val step: String? = null
)

@Serializable
data class CodeRequest(
    val code: String
)