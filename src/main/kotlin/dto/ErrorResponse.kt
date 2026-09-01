package com.viber.dto

import kotlinx.serialization.Serializable

/** Единая форма ошибки для маршрутов, читающих базу устройства. */
@Serializable
data class ErrorResponse(
    val error: String
)
