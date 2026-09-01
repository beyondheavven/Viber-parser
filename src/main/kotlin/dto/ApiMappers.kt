package com.viber.dto

import com.viber.device.model.ViberGroup
import com.viber.device.model.ViberMember

/**
 * Перевод моделей базы в форму HTTP-ответа. Слои держим врозь: форма JSON меняется под
 * клиента, модели — под то, что реально лежит в базе устройства.
 */
fun List<ViberGroup>.toGroupsResponse(): GroupsResponse =
    GroupsResponse(count = size, groups = map { it.toResponse() })

fun ViberGroup.toResponse(): GroupResponse = GroupResponse(
    conversationId = conversationId,
    groupId = groupId,
    name = name,
    conversationType = conversationType,
    memberCount = memberCount,
)

fun ViberGroup.toMembersResponse(members: List<ViberMember>): MembersResponse = MembersResponse(
    conversationId = conversationId,
    groupName = name,
    count = members.size,
    members = members.map { it.toResponse() },
)

fun ViberMember.toResponse(): MemberResponse = MemberResponse(
    participantId = participantId,
    memberId = memberId,
    encryptedMemberId = encryptedMemberId,
    number = number,
    displayedName = displayedName,
    displayName = displayName,
    contactName = contactName,
    viberName = viberName,
    aliasName = aliasName,
    active = active,
    groupRole = groupRole,
)
