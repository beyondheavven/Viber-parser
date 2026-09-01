package com.viber.device.model

/**
 * Участник группы: строка `participants`, склеенная с карточкой из `participants_info`.
 *
 * @property encryptedMemberId ключ, по которому склеиваются две карточки одного человека.
 *   Заполнен там, где [memberId] может оказаться тем же зашифрованным значением.
 * @property number настоящий телефон — но только если победила карточка
 *   `participant_type = 1`; у человека, которого Viber отдал лишь зашифрованной карточкой,
 *   здесь окажется зашифрованное значение.
 * @property active false — человек вышел из группы; такие строки отдаются только по
 *   явному запросу.
 * @property groupRole сырое значение Viber: встречаются 1, 2 и 3.
 */
data class ViberMember(
    val participantId: Long,
    val infoId: Long,
    val memberId: String?,
    val encryptedMemberId: String?,
    val number: String?,
    val displayName: String?,
    val contactName: String?,
    val viberName: String?,
    val aliasName: String?,
    val active: Boolean,
    val groupRole: Int,
) {
    /**
     * То, что видно в списке участников: имя, заданное внутри группы, затем готовый
     * display_name от Viber, затем что осталось. Номер — последний рубеж, он есть не всегда.
     */
    val displayedName: String?
        get() = sequenceOf(aliasName, displayName, contactName, viberName, number)
            .firstOrNull { !it.isNullOrBlank() }
}
