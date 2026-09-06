package com.viber.dto

import kotlinx.serialization.Serializable

/** Тело `POST /api/scroll-members`: имя группы так, как оно видно в списке чатов Viber. */
@Serializable
data class ScrollMembersRequest(
    val groupName: String
)
