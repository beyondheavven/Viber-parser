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


@Serializable
data class MemberResponse(
    val participantId: Long,
    val memberId: String?,
    val encryptedMemberId: String?,
    val number: String?,
    val displayedName: String?,
    val displayName: String?,
    val contactName: String?,
    val viberName: String?,
    val aliasName: String?,
    val active: Boolean,
    val groupRole: Int
)

@Serializable
data class MembersResponse(
    val conversationId: Long,
    val groupName: String?,
    val count: Int,
    val members: List<MemberResponse>
)
