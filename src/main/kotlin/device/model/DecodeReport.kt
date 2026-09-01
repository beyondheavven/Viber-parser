package com.viber.device.model

/**
 * Что и как разбирать.
 *
 * @property dryRun только посчитать и отчитаться, на устройство ничего не отправлять.
 * @property includeSelf трогать и карточку собственного аккаунта. По умолчанию нет:
 *   в ней лежит логин, которым бот подключён к Viber, и стирать его номер — верный
 *   способ разлогиниться.
 * @property limit сколько карточек править. Режет уже разобранные, а не прочитанные:
 *   `limit = 2` при десяти строках означает «две настоящие правки», а не «загляни в две
 *   первые строки».
 * @property restartApp поднять Viber после правки. Останавливаем его в любом случае —
 *   иначе он перезапишет базу из своего кэша.
 */
data class DecodeOptions(
    val dryRun: Boolean = false,
    val includeSelf: Boolean = false,
    val limit: Int? = null,
    val restartApp: Boolean = true,
)

/**
 * Состояние, к которому приводится каждая карточка. Одно определение и на UPDATE, и на
 * отчёт: разъехавшись, они начали бы врать друг про друга — ответ показывал бы одно, а
 * база хранила другое.
 */
object NormalisedCard {

    /** `participant_type` карточки с настоящим номером. Пишем всегда его. */
    const val PARTICIPANT_TYPE = 1

    /** `safe_contact` снимаем. */
    const val SAFE_CONTACT = 0
}

/**
 * Одна карточка, приведённая к виду, который мы записываем.
 *
 * Поля `previous*` — то, что было в строке до правки; всё остальное — то, что станет.
 * `number` в этом списке нет намеренно: после правки он всегда NULL, и показывать в
 * каждой строке одно и то же `null` незачем — интересно как раз [previousNumber].
 */
data class DecodedParticipant(
    val infoId: Long,
    val name: String?,
    val newMemberId: String,
    val previousMemberId: String?,
    val previousNumber: String?,
    val previousParticipantType: Int?,
) {

    /** Что окажется в `participant_type` — 1 независимо от того, что там лежало. */
    val participantType: Int get() = NormalisedCard.PARTICIPANT_TYPE

    /** Что окажется в `safe_contact`. */
    val safeContact: Int get() = NormalisedCard.SAFE_CONTACT

    /**
     * Разошёлся ли извлечённый ключ с тем, что уже лежит в `member_id`. На живой базе
     * почти всегда false — Viber хранит там те же байты, см. [com.viber.device.EmKey].
     */
    val memberIdChanged: Boolean get() = previousMemberId != newMemberId
}

/** Почему карточку не тронули. */
enum class SkipReason {
    /** Разбирать нечего: колонка пустая. */
    NO_ENCRYPTED_MEMBER_ID,

    /** `participant_type = 0` — собственный аккаунт, защищён по умолчанию. */
    OWN_ACCOUNT,

    /**
     * Строка уже в том виде, который мы записываем: `member_id` равен ключу из конверта,
     * `participant_type = 1`, `safe_contact = 0`. `number` в этот признак намеренно не
     * входит — Viber возвращает его через пару секунд после старта, и учитывать его
     * значило бы переписывать всю таблицу на каждом вызове.
     */
    ALREADY_DECODED,

    /** Разобрана успешно, но не попала в `limit`. */
    OVER_LIMIT,
}

data class SkippedParticipant(val infoId: Long, val reason: SkipReason)

/** Конверт, который не удалось прочитать. Прогон продолжается, строка идёт в отчёт. */
data class InvalidParticipant(val infoId: Long, val encryptedMemberId: String?, val error: String)

/**
 * @property read сколько строк вообще прочитано из `participants_info`.
 * @property updated сколько UPDATE ушло на устройство; 0 при [dryRun].
 * @property changedRows сколько строк изменила сама база (`total_changes()`), null — если
 *   устройство не ответило числом. Расхождение с [updated] значит, что часть `_id` не нашлась.
 * @property backupPath копия базы, снятая перед записью.
 */
data class DecodeReport(
    val dryRun: Boolean,
    val read: Int,
    val decoded: List<DecodedParticipant>,
    val skipped: List<SkippedParticipant>,
    val invalid: List<InvalidParticipant>,
    val updated: Int,
    val changedRows: Int?,
    val backupPath: String?,
)
