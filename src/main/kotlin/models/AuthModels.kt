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

@Serializable
data class QrStartRequest(
    val phoneNumber: String? = null,
    val countryCode: String? = null,
    val clearData: Boolean? = null,
    val userName: String? = null
)

@Serializable
data class QrStartResponse(
    val state: String,
    val message: String
)

@Serializable
data class QrCode(
    val payload: String? = null,
    val svg: String? = null,
    val pngBase64: String? = null,
    val capturedAt: String
)

@Serializable
data class QrStatus(
    val state: String,
    val qr: QrCode? = null,
    val screenHint: String? = null,
    val screenshotBase64: String? = null,
    val error: String? = null,
    val startedAt: String? = null,
    val updatedAt: String? = null
)