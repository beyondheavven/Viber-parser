package com.viber.dto

import kotlinx.serialization.Serializable

/** Группа в ответе `GET /api/groups`. */
@Serializable
data class GroupResponse(
    val conversationId: Long,
    val groupId: Long,
    val name: String?,
    val conversationType: Int,
    val memberCount: Int
)

@Serializable
data class GroupsResponse(
    val count: Int,
    val groups: List<GroupResponse>
)
