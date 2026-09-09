package com.viber.models

import kotlinx.serialization.Serializable

@Serializable
data class GroupSummary(
    val id: Int,

    val type: Int,

    val groupId: String? = null,

    val name: String? = null,

    val messageCount: Int,

    val participantCount: Int,

    val unreadCount: Int,

    val lastMessageDate: String? = null
)

@Serializable
data class GroupParticipantSample(
    val id: Int,

    val name: String? = null,

    val number: String? = null,

    val roleLabel: String
)


@Serializable
data class GroupDetail(
    val id: Int,

    val type: Int,

    val groupId: String? = null,

    val name: String? = null,

    val messageCount: Int,

    val participantCount: Int,

    val unreadCount: Int,

    val lastMessageDate: String? = null,

    val sampleParticipants: List<GroupParticipantSample>? = null,
)
