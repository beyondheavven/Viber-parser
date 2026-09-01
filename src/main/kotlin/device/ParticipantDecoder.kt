package com.viber.device

import com.viber.device.model.DecodeOptions
import com.viber.device.model.DecodeReport
import com.viber.device.model.DecodedParticipant
import com.viber.device.model.InvalidParticipant
import com.viber.device.model.NormalisedCard
import com.viber.device.model.ParticipantCard
import com.viber.device.model.SkipReason
import com.viber.device.model.SkippedParticipant
import org.slf4j.LoggerFactory

/**
 * Приводит карточки `participants_info` к виду «обычный участник с открытым member_id».
 *
 * Для каждой строки берёт ключ из конверта `encrypted_member_id` (см. [EmKey]) и пишет
 * его в `member_id`, стирая `number` и выставляя `participant_type = 1`,
 * `safe_contact = 0`. Ключ почти всегда совпадает с тем, что в `member_id` уже лежит —
 * настоящий эффект в остальных трёх колонках.
 *
 * Чтение и запись идут через разные seam'ы ([SqlExecutor] и [SqlWriter]) — не только
 * ради тестов без устройства: читаем мы базу read-only, а пишем, погасив Viber и сняв
 * копию, и путать эти два режима нельзя.
 */
class ParticipantDecoder(
    private val executor: SqlExecutor,
    private val writer: SqlWriter,
) {

    private val logger = LoggerFactory.getLogger(ParticipantDecoder::class.java)

    fun decode(options: DecodeOptions = DecodeOptions()): DecodeReport {
        val cards = executor.query(SELECT).map { it.toParticipantCard() }

        val decoded = mutableListOf<DecodedParticipant>()
        val skipped = mutableListOf<SkippedParticipant>()
        val invalid = mutableListOf<InvalidParticipant>()

        cards.forEach { card ->
            when {
                card.encryptedMemberId.isNullOrBlank() ->
                    skipped += SkippedParticipant(card.infoId, SkipReason.NO_ENCRYPTED_MEMBER_ID)

                card.participantType == OWN_ACCOUNT && !options.includeSelf ->
                    skipped += SkippedParticipant(card.infoId, SkipReason.OWN_ACCOUNT)

                else -> try {
                    val key = EmKey.extract(card.encryptedMemberId)
                    when {
                        card.isNormalised(key) ->
                            skipped += SkippedParticipant(card.infoId, SkipReason.ALREADY_DECODED)

                        else -> decoded += card.decodedWith(key)
                    }
                } catch (e: IllegalArgumentException) {
                    invalid += InvalidParticipant(
                        card.infoId,
                        card.encryptedMemberId,
                        e.message ?: e::class.simpleName.orEmpty(),
                    )
                }
            }
        }

        // limit режет разобранные, а не прочитанные — кривые конверты попадают в отчёт
        // независимо от него: ограничиваем объём правки, а не глубину осмотра.
        val target = options.limit?.let(decoded::take) ?: decoded
        decoded.drop(target.size).forEach { skipped += SkippedParticipant(it.infoId, SkipReason.OVER_LIMIT) }

        val statements = target.map { it.update() }
        val write = when {
            options.dryRun || statements.isEmpty() -> null
            else -> writer.execute(statements, options.restartApp)
        }

        logger.info(
            "Decoded {} of {} participant cards (skipped {}, invalid {}), {} statements sent{}",
            target.size, cards.size, skipped.size, invalid.size,
            if (options.dryRun) 0 else statements.size,
            write?.changedRows?.let { ", $it rows changed on the device" } ?: "",
        )

        return DecodeReport(
            dryRun = options.dryRun,
            read = cards.size,
            decoded = target,
            skipped = skipped,
            invalid = invalid,
            updated = if (options.dryRun) 0 else statements.size,
            changedRows = write?.changedRows,
            backupPath = write?.backupPath,
        )
    }

    /**
     * Строка уже такая, какой мы бы её записали, — трогать нечего.
     *
     * Признак — `member_id`: у неразобранной карточки там лежит сам конверт, у разобранной
     * ключ из него. `number` в проверку не входит намеренно: Viber возвращает номер через
     * пару секунд после запуска, поэтому «номер на месте» означало бы «не разобрано» вечно,
     * и каждый вызов переписывал бы всю таблицу.
     */
    private fun ParticipantCard.isNormalised(key: String): Boolean =
        memberId == key &&
            participantType == NormalisedCard.PARTICIPANT_TYPE &&
            safeContact == NormalisedCard.SAFE_CONTACT

    private fun ParticipantCard.decodedWith(key: String) = DecodedParticipant(
        infoId = infoId,
        name = name,
        newMemberId = key,
        previousMemberId = memberId,
        previousNumber = number,
        previousParticipantType = participantType,
    )

    /** Ключ — base64, кавычки в нём быть не может; [quote] здесь как правило, а не как надежда. */
    private fun DecodedParticipant.update(): String =
        "update participants_info set member_id = ${quote(newMemberId)}, number = null, " +
            "participant_type = $participantType, safe_contact = $safeContact where _id = $infoId;"

    private companion object {

        /** `participant_type` собственного аккаунта. */
        const val OWN_ACCOUNT = 0

        /**
         * Девять колонок, которых хватает и на решение, и на отчёт. Оборачивать текст в
         * `hex()`, как это приходится делать при pipe-разделённом выводе sqlite3, здесь не
         * нужно: [SqliteCsv] читает настоящий CSV, поэтому эмодзи, переводы строк и запятые
         * в именах доезжают целыми.
         */
        val SELECT = """
            select _id,
                   member_id,
                   encrypted_member_id,
                   number,
                   participant_type,
                   contact_name,
                   display_name,
                   viber_name,
                   safe_contact
            from participants_info
            order by _id asc;
        """.trimIndent()
    }
}
