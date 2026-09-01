package com.viber.dto

import kotlinx.serialization.Serializable

/** Ответ `GET /api/status`: состояние машины разбора и жив ли драйвер. */
@Serializable
data class StatusResponse(
    val state: String,
    val isDriverActive: Boolean
)
