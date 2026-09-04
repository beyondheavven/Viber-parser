package com.viber.device.viber

/**
 * Беседа-группа из `conversations`.
 *
 * @property conversationId `conversations._id` — им адресуются участники.
 * @property groupId идентификатор группы в самом Viber; в API он только для сверки.
 * @property conversationType сырое значение Viber: 0 — личный чат, остальное — групповые.
 * @property memberCount активные участники, посчитанные по людям, а не по строкам
 *   `participants` (одного человека Viber хранит двумя карточками).
 */
data class ViberGroup(
    val conversationId: Long,
    val groupId: Long,
    val name: String?,
    val conversationType: Int,
    val memberCount: Int,
)
