package com.viber.device.participants

import com.viber.device.sqlite.Row

/**
 * Сырая строка `participants_info` — без склейки карточек одного человека: правим мы
 * каждую строку отдельно.
 *
 * Лежит здесь, а не рядом с разбором строк Viber: маппинг принадлежит той задаче, чью
 * модель он собирает, а не таблице, из которой читает. Имена колонок обязаны совпадать
 * с тем, что просит [ParticipantDecoder].
 */
internal fun Row.toParticipantCard(): ParticipantCard = ParticipantCard(
    infoId = requireLong("_id"),
    memberId = string("member_id"),
    encryptedMemberId = string("encrypted_member_id"),
    number = string("number"),
    participantType = int("participant_type"),
    contactName = string("contact_name"),
    displayName = string("display_name"),
    viberName = string("viber_name"),
    safeContact = int("safe_contact"),
)
