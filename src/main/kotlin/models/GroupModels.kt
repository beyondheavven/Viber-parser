package com.viber.models

import kotlinx.serialization.Serializable

@Serializable
data class GroupSummaryDto(
    val id: Int,

    val type: Int,

    val groupId: String? = null,

    val name: String? = null,

    val messageCount: Int,

    val participantCount: Int,

    val unreadCount: Int,

    val lastMessageDate: String? = null
)
