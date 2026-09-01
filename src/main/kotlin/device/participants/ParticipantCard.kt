package com.viber.device.participants

/**
 * Строка `participants_info` такой, какая она сейчас на устройстве — до правки.
 *
 * Отличается от [ViberMember] тем, что это именно строка таблицы, а не человек: две
 * карточки одного участника здесь остаются двумя карточками, потому что править надо
 * каждую.
 *
 * @property participantType 1 — карточка с настоящим номером, 2 — с зашифрованным,
 *   0 — наш собственный аккаунт. NULL оставляем NULL: подставить сюда 0 значило бы
 *   принять чужую строку за свою и молча её пропустить.
 */
data class ParticipantCard(
    val infoId: Long,
    val memberId: String?,
    val encryptedMemberId: String?,
    val number: String?,
    val participantType: Int?,
    val contactName: String?,
    val displayName: String?,
    val viberName: String?,
    val safeContact: Int?,
) {

    /** Имя для отчёта: контактное, затем показываемое, затем то, что человек задал в Viber. */
    val name: String?
        get() = sequenceOf(contactName, displayName, viberName).firstOrNull { !it.isNullOrBlank() }
}
