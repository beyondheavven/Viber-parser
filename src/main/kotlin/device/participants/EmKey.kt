package com.viber.device.participants

import java.util.Base64

/**
 * Разбор `encrypted_member_id`.
 *
 * Вопреки имени колонки шифра здесь нет: значение — конверт из 42 байт с фиксированной
 * раскладкой, и нужные нам 8 байт лежат в нём открытым текстом. Ни ключа, ни IV, ни
 * преобразований — только смещения:
 *
 * ```
 * 0..2    версия  01 00   — проверяем
 * 2..10   ключ            — забираем, это и есть member_id
 * 10..12  маркер  1a 6f   — проверяем
 * 12..14  00 00           — не смотрим
 * 14..42  хвост           — не трогаем
 * ```
 *
 * Хвост — единственное, что похоже на криптографическую нагрузку, — здесь не
 * расшифровывается и телефон из него не восстанавливается: [ParticipantDecoder] номер,
 * наоборот, стирает. Проверка на живых данных: у карточки собственного аккаунта, которую
 * скрипт никогда не трогал, `member_id` уже равен извлечённому ключу — Viber сам хранит
 * в `member_id` те же 8 байт, а конверт лишь дублирует их.
 *
 * Отсюда следует, что настоящий эффект правки — не в `member_id` (он и так совпадает), а
 * в `number`, `participant_type` и `safe_contact`.
 */
object EmKey {

    /** Значение в базе иногда приходит с этим префиксом — 59 символов вместо 56. */
    private const val PREFIX = "em:"

    /** 2 версия + 8 ключ + 2 маркер + 30 хвоста. Ровно 42, поэтому base64 идёт без `=`. */
    const val ENVELOPE_SIZE = 42

    private val VERSION = byteArrayOf(0x01, 0x00)
    private val MARKER = byteArrayOf(0x1a, 0x6f)

    private const val KEY_OFFSET = 2
    private const val KEY_SIZE = 8
    private const val MARKER_OFFSET = 10

    /**
     * @return 8 байт ключа в base64 — ровно то, что лежит в `member_id`.
     * @throws IllegalArgumentException если это не тот конверт, который мы умеем читать.
     *   Строка целиком попадает в отчёт: одна кривая карточка не должна валить весь прогон.
     */
    fun extract(encrypted: String): String {
        val encoded = encrypted.trim().removePrefix(PREFIX)
        require(encoded.isNotEmpty()) { "encrypted_member_id is empty" }

        val envelope = try {
            Base64.getDecoder().decode(encoded)
        } catch (e: IllegalArgumentException) {
            throw IllegalArgumentException("encrypted_member_id is not base64: ${e.message}", e)
        }

        require(envelope.size == ENVELOPE_SIZE) {
            "encrypted_member_id must decode to $ENVELOPE_SIZE bytes, got ${envelope.size}"
        }
        require(envelope.startsWith(VERSION, at = 0)) {
            "unknown envelope version ${envelope.hex(0, VERSION.size)}, expected ${VERSION.hex(0, VERSION.size)}"
        }
        require(envelope.startsWith(MARKER, at = MARKER_OFFSET)) {
            "no envelope marker ${MARKER.hex(0, MARKER.size)} at byte $MARKER_OFFSET, " +
                "found ${envelope.hex(MARKER_OFFSET, MARKER_OFFSET + MARKER.size)}"
        }

        return Base64.getEncoder().encodeToString(envelope.copyOfRange(KEY_OFFSET, KEY_OFFSET + KEY_SIZE))
    }

    private fun ByteArray.startsWith(expected: ByteArray, at: Int): Boolean =
        expected.indices.all { this[at + it] == expected[it] }

    private fun ByteArray.hex(from: Int, to: Int): String =
        (from until to).joinToString(" ") { "%02x".format(this[it]) }
}
