package com.viber.models

import kotlinx.serialization.Serializable


@Serializable
data class FridaBridgeResult(
    val success: Boolean,
    val messages: List<String> = emptyList(),
    val error: String? = null
)