package com.viber.device

import com.viber.device.model.ViberGroup
import com.viber.device.model.ViberMember

/**
 * Разбор строк CSV в модели. Держится отдельно от [ViberDatabase]: там — что спрашиваем
 * у базы, здесь — как читаем ответ. Имена колонок обязаны совпадать с алиасами запросов.
 */
internal fun Row.toViberGroup(): ViberGroup = ViberGroup(
    conversationId = requireLong("_id"),
    groupId = long("group_id") ?: 0L,
    name = string("name"),
    conversationType = int("conversation_type") ?: 0,
    memberCount = int("members") ?: 0,
)

internal fun Row.toViberMember(): ViberMember = ViberMember(
    participantId = requireLong("participant_id"),
    infoId = long("info_id") ?: 0L,
    memberId = string("member_id"),
    encryptedMemberId = string("encrypted_member_id"),
    number = string("number"),
    displayName = string("display_name"),
    contactName = string("contact_name"),
    viberName = string("viber_name"),
    aliasName = string("alias_name"),
    active = boolean("active"),
    groupRole = int("group_role") ?: 0,
)
