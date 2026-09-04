package com.viber.device.participants

import com.viber.device.sqlite.Row
import com.viber.device.SqlExecutor
import com.viber.device.SqlWriter
import com.viber.device.sqlite.SqliteCsv
import com.viber.device.WriteResult
import java.util.Base64
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class ParticipantDecoderTest {

    private class FakeExecutor(private val csv: String = "") : SqlExecutor {
        var lastSql: String? = null
        override fun query(sql: String): List<Row> {
            lastSql = sql
            return SqliteCsv.parse(csv)
        }
    }

    private class FakeWriter(private val changed: Int? = null) : SqlWriter {
        var statements: List<String>? = null
        var restartApp: Boolean? = null
        override fun execute(statements: List<String>, restartApp: Boolean): WriteResult {
            this.statements = statements
            this.restartApp = restartApp
            return WriteResult(changedRows = changed, backupPath = "/data/db.bak")
        }
    }

    /** 42-байтный конверт, в котором на месте ключа лежат заданные байты. */
    private fun envelope(vararg key: Int): String {
        val bytes = byteArrayOf(0x01, 0x00) +
            ByteArray(8) { key.getOrElse(it) { 0 }.toByte() } +
            byteArrayOf(0x1a, 0x6f) +
            ByteArray(30)
        return Base64.getEncoder().encodeToString(bytes)
    }

    private val header =
        "_id,member_id,encrypted_member_id,number,participant_type,contact_name,display_name,viber_name,safe_contact"

    private val liveKey = intArrayOf(0x18, 0xf3, 0x2f, 0x20, 0xc8, 0x56, 0xa2, 0xe4)

    @Test
    fun `reads the nine columns it needs from participants_info in id order`() {
        val executor = FakeExecutor()

        ParticipantDecoder(executor, FakeWriter()).decode()

        val sql = executor.lastSql!!
        assertTrue(sql.contains("from participants_info"), sql)
        assertTrue(sql.contains("order by _id asc"), sql)
        listOf(
            "_id", "member_id", "encrypted_member_id", "number",
            "participant_type", "contact_name", "display_name", "viber_name", "safe_contact",
        ).forEach { assertTrue(sql.contains(it), "no column '" + it + "' in: " + sql) }
    }

    @Test
    fun `turns an encrypted card into the key that belongs in member_id`() {
        val executor = FakeExecutor(
            header + "\r\n7,old," + envelope(*liveKey) + ",+37529,2,,Пётр,,1\r\n"
        )

        val report = ParticipantDecoder(executor, FakeWriter()).decode()

        assertEquals(1, report.read)
        assertEquals(1, report.decoded.size)
        val decoded = report.decoded.single()
        assertEquals(7L, decoded.infoId)
        assertEquals("GPMvIMhWouQ=", decoded.newMemberId)
        assertEquals("old", decoded.previousMemberId)
        assertEquals("+37529", decoded.previousNumber)
        assertEquals("Пётр", decoded.name)
        assertTrue(decoded.memberIdChanged)
    }

    @Test
    fun `writes member_id, clears the number and normalises the card`() {
        val executor = FakeExecutor(header + "\r\n7,old," + envelope(1) + ",+37529,2,,,,1\r\n")
        val writer = FakeWriter(changed = 1)

        val report = ParticipantDecoder(executor, writer).decode()

        val statement = writer.statements!!.single()
        assertTrue(statement.startsWith("update participants_info set"), statement)
        assertTrue(statement.contains("member_id = '" + report.decoded.single().newMemberId + "'"), statement)
        assertTrue(statement.contains("number = null"), statement)
        assertTrue(statement.contains("participant_type = 1"), statement)
        assertTrue(statement.contains("safe_contact = 0"), statement)
        assertTrue(statement.contains("where _id = 7"), statement)
        assertEquals(1, report.updated)
        assertEquals(1, report.changedRows)
        assertEquals("/data/db.bak", report.backupPath)
    }

    @Test
    fun `normalises every card to participant_type 1, whatever it was before`() {
        val executor = FakeExecutor(
            header + "\r\n" +
                "1,old," + envelope(1) + ",+37529,2,,,,1\r\n" +
                "2,old," + envelope(2) + ",,1,,,,0\r\n" +
                "3,own," + envelope(3) + ",+37529,0,,,,0\r\n"
        )
        val writer = FakeWriter()

        val report = ParticipantDecoder(executor, writer).decode(DecodeOptions(includeSelf = true))

        assertEquals(listOf(2, 1, 0), report.decoded.map { it.previousParticipantType })
        // И в отчёте, и в SQL — единица, а не то, что лежало в строке.
        assertTrue(report.decoded.all { it.participantType == 1 }, report.decoded.toString())
        writer.statements!!.forEach { assertTrue(it.contains("participant_type = 1"), it) }
    }

    @Test
    fun `skips a card that has no encrypted_member_id`() {
        val executor = FakeExecutor(header + "\r\n7,old,,+37529,2,,,,1\r\n8,old,\"   \",,2,,,,1\r\n")
        val writer = FakeWriter()

        val report = ParticipantDecoder(executor, writer).decode()

        assertEquals(2, report.read)
        assertTrue(report.decoded.isEmpty())
        assertEquals(listOf(7L, 8L), report.skipped.map { it.infoId })
        assertTrue(report.skipped.all { it.reason == SkipReason.NO_ENCRYPTED_MEMBER_ID })
        assertNull(writer.statements)
    }

    @Test
    fun `leaves our own account alone unless asked otherwise`() {
        val csv = header + "\r\n7,own," + envelope(1) + ",+37529,0,,,,0\r\n"

        val kept = ParticipantDecoder(FakeExecutor(csv), FakeWriter()).decode()
        assertTrue(kept.decoded.isEmpty())
        assertEquals(SkipReason.OWN_ACCOUNT, kept.skipped.single().reason)

        val touched = ParticipantDecoder(FakeExecutor(csv), FakeWriter())
            .decode(DecodeOptions(includeSelf = true))
        assertEquals(1, touched.decoded.size)
        assertTrue(touched.skipped.isEmpty())
    }

    @Test
    fun `collects a broken envelope instead of failing the whole run`() {
        val executor = FakeExecutor(
            header + "\r\n7,old,not-an-envelope,,2,,,,1\r\n8,old," + envelope(2) + ",,2,,,,1\r\n"
        )

        val report = ParticipantDecoder(executor, FakeWriter()).decode()

        assertEquals(1, report.decoded.size)
        assertEquals(8L, report.decoded.single().infoId)
        assertEquals(7L, report.invalid.single().infoId)
        assertTrue(report.invalid.single().error.isNotBlank())
    }

    @Test
    fun `limits the cards it decodes, not the ones it reads`() {
        val rows = (1..5).joinToString("") { it.toString() + ",old,,,2,,,,1\r\n" } +
            (6..10).joinToString("") { it.toString() + ",old," + envelope(it) + ",,2,,,,1\r\n" }
        val executor = FakeExecutor(header + "\r\n" + rows)
        val writer = FakeWriter()

        val report = ParticipantDecoder(executor, writer).decode(DecodeOptions(limit = 2))

        assertEquals(10, report.read)
        assertEquals(listOf(6L, 7L), report.decoded.map { it.infoId })
        assertEquals(2, writer.statements!!.size)
        assertEquals(
            listOf(8L, 9L, 10L),
            report.skipped.filter { it.reason == SkipReason.OVER_LIMIT }.map { it.infoId },
        )
    }

    @Test
    fun `a dry run reports what it would do and touches nothing`() {
        val executor = FakeExecutor(header + "\r\n7,old," + envelope(1) + ",+37529,2,,,,1\r\n")
        val writer = FakeWriter()

        val report = ParticipantDecoder(executor, writer).decode(DecodeOptions(dryRun = true))

        assertTrue(report.dryRun)
        assertEquals(1, report.decoded.size)
        assertEquals(0, report.updated)
        assertNull(report.changedRows)
        assertNull(report.backupPath)
        assertNull(writer.statements)
    }

    @Test
    fun `does not go to the device when there is nothing to update`() {
        val writer = FakeWriter()

        val report = ParticipantDecoder(FakeExecutor(), writer).decode()

        assertEquals(0, report.read)
        assertEquals(0, report.updated)
        assertNull(writer.statements)
    }

    @Test
    fun `names the person by contact name, then display name, then viber name`() {
        val executor = FakeExecutor(
            header + "\r\n" +
                "1,old," + envelope(1) + ",,2,Контакт,Показываемое,Viber,1\r\n" +
                "2,old," + envelope(2) + ",,2,,Показываемое,Viber,1\r\n" +
                "3,old," + envelope(3) + ",,2,,,Viber,1\r\n" +
                "4,old," + envelope(4) + ",,2,,,,1\r\n"
        )

        val names = ParticipantDecoder(executor, FakeWriter()).decode().decoded.map { it.name }

        assertEquals(listOf("Контакт", "Показываемое", "Viber", null), names)
    }

    @Test
    fun `passes the caller's restart choice down to the device`() {
        val csv = header + "\r\n7,old," + envelope(1) + ",,2,,,,1\r\n"

        val restarting = FakeWriter()
        ParticipantDecoder(FakeExecutor(csv), restarting).decode()
        assertEquals(true, restarting.restartApp)

        val quiet = FakeWriter()
        ParticipantDecoder(FakeExecutor(csv), quiet).decode(DecodeOptions(restartApp = false))
        assertEquals(false, quiet.restartApp)
    }

    /** Ключ, который извлечётся из `envelope(...)` с теми же байтами. */
    private fun keyOf(vararg key: Int): String =
        Base64.getEncoder().encodeToString(ByteArray(8) { key.getOrElse(it) { 0 }.toByte() })

    private val key1 = keyOf(1)

    @Test
    fun `leaves alone a card that already holds the decoded key`() {
        val executor = FakeExecutor(header + "\r\n7," + key1 + "," + envelope(1) + ",,1,,,,0\r\n")
        val writer = FakeWriter()

        val report = ParticipantDecoder(executor, writer).decode()

        assertTrue(report.decoded.isEmpty())
        assertEquals(SkipReason.ALREADY_DECODED, report.skipped.single().reason)
        assertNull(writer.statements)
    }

    @Test
    fun `a number Viber put back does not make a decoded card look undecoded`() {
        // Viber возвращает number через пару секунд после старта. Считать это признаком
        // «не разобрано» значило бы переписывать всю таблицу на каждом вызове.
        val executor = FakeExecutor(header + "\r\n7," + key1 + "," + envelope(1) + ",+380672208374,1,,,,0\r\n")

        val report = ParticipantDecoder(executor, FakeWriter()).decode()

        assertTrue(report.decoded.isEmpty())
        assertEquals(SkipReason.ALREADY_DECODED, report.skipped.single().reason)
    }

    @Test
    fun `decodes a card whose member_id still holds the envelope itself`() {
        val executor = FakeExecutor(
            header + "\r\n7," + envelope(1) + "," + envelope(1) + ",encrypted-junk,2,,,,1\r\n"
        )

        val report = ParticipantDecoder(executor, FakeWriter()).decode()

        assertEquals(listOf(7L), report.decoded.map { it.infoId })
        assertTrue(report.decoded.single().memberIdChanged)
    }

    @Test
    fun `still normalises a card whose key matches but whose other columns do not`() {
        val executor = FakeExecutor(
            header + "\r\n" +
                "7," + key1 + "," + envelope(1) + ",,2,,,,0\r\n" +
                "8," + key1 + "," + envelope(1) + ",,1,,,,1\r\n"
        )

        val report = ParticipantDecoder(executor, FakeWriter()).decode()

        assertEquals(listOf(7L, 8L), report.decoded.map { it.infoId })
        assertTrue(report.decoded.none { it.memberIdChanged })
    }

    @Test
    fun `a card that needs nothing does not eat into the limit`() {
        val executor = FakeExecutor(
            header + "\r\n" +
                "1," + key1 + "," + envelope(1) + ",,1,,,,0\r\n" +
                "2,old," + envelope(2) + ",,2,,,,1\r\n" +
                "3,old," + envelope(3) + ",,2,,,,1\r\n"
        )

        val report = ParticipantDecoder(executor, FakeWriter()).decode(DecodeOptions(limit = 2))

        assertEquals(listOf(2L, 3L), report.decoded.map { it.infoId })
        assertEquals(
            listOf(SkipReason.ALREADY_DECODED),
            report.skipped.map { it.reason },
        )
    }

    @Test
    fun `escapes the key it puts into sql even though base64 cannot contain a quote`() {
        val executor = FakeExecutor(header + "\r\n7,old," + envelope(1) + ",,2,,,,1\r\n")
        val writer = FakeWriter()

        ParticipantDecoder(executor, writer).decode()

        val statement = writer.statements!!.single()
        assertTrue(Regex("member_id = '[A-Za-z0-9+/=]+'").containsMatchIn(statement), statement)
    }
}
