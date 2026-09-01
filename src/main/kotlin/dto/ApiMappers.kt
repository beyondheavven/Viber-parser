package com.viber.dto

import com.viber.device.participants.DecodeOptions
import com.viber.device.participants.DecodeReport
import com.viber.device.participants.DecodedParticipant
import com.viber.device.participants.InvalidParticipant
import com.viber.device.participants.SkippedParticipant
import com.viber.device.viber.ViberGroup
import com.viber.device.viber.ViberMember

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

fun DecodeParticipantsRequest.toDecodeOptions(): DecodeOptions = DecodeOptions(
    dryRun = dryRun,
    includeSelf = includeSelf,
    limit = limit,
    restartApp = restartApp,
)

fun DecodeReport.toResponse(): DecodeParticipantsResponse = DecodeParticipantsResponse(
    dryRun = dryRun,
    read = read,
    decodedCount = decoded.size,
    updated = updated,
    changedRows = changedRows,
    skippedCount = skipped.size,
    invalidCount = invalid.size,
    backupPath = backupPath,
    decoded = decoded.map { it.toResponse() },
    skipped = skipped.map { it.toResponse() },
    invalid = invalid.map { it.toResponse() },
)

fun DecodedParticipant.toResponse(): DecodedParticipantResponse = DecodedParticipantResponse(
    infoId = infoId,
    name = name,
    newMemberId = newMemberId,
    memberIdChanged = memberIdChanged,
    participantType = participantType,
    safeContact = safeContact,
    previousMemberId = previousMemberId,
    previousNumber = previousNumber,
    previousParticipantType = previousParticipantType,
)

fun SkippedParticipant.toResponse(): SkippedParticipantResponse =
    SkippedParticipantResponse(infoId = infoId, reason = reason.name)

fun InvalidParticipant.toResponse(): InvalidParticipantResponse =
    InvalidParticipantResponse(infoId = infoId, encryptedMemberId = encryptedMemberId, error = error)
