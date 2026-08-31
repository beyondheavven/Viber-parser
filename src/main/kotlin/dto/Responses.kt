package com.viber.dto

import kotlinx.serialization.Serializable

@Serializable
data class ScrollMembersRequest(
    val groupName: String
)

@Serializable
data class StatusResponse(
    val state: String,
    val isDriverActive: Boolean
)