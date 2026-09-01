package com.viber.dto

import kotlinx.serialization.Serializable

/**
 * Участник в ответе `GET /api/groups/{id}/members`.
 *
 * Отдаём и готовое [displayedName], и все имена по отдельности: клиенту бывает нужно
 * именно контактное имя или именно то, что человек задал внутри группы.
 */
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
