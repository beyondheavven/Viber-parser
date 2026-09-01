package com.viber

import com.viber.device.AdbSqlite
import java.util.Base64
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class AdbSqliteTest {

    private val db = "/data/data/com.viber.voip/databases/viber_messages"

    private fun sqlite(adbPath: String? = "adb") =
        AdbSqlite(udid = "127.0.0.1:5555", adbPath = adbPath, databasePath = db)

    @Test
    fun `runs the query over 'adb shell -T' so the exit code survives`() {
        val command = sqlite().command("select 1;")

        assertEquals("adb", command.first())
        assertEquals(listOf("-s", "127.0.0.1:5555", "shell", "-T"), command.subList(1, 5))
        assertEquals(6, command.size)
    }

    @Test
    fun `ships the statement as base64 so quotes and newlines cannot break the shell`() {
        val sql = "select * from t where name = 'O''Brian, \"Bob\"'\nlimit 1;"

        val remote = sqlite().command(sql).last()

        val payload = Regex("""echo ([A-Za-z0-9+/=]+) \|""").find(remote)?.groupValues?.get(1)
        assertTrue(payload != null, "no base64 payload in: $remote")
        assertEquals(sql, String(Base64.getDecoder().decode(payload)))
    }

    @Test
    fun `asks sqlite for csv with a header and opens the database read-only`() {
        val remote = sqlite().command("select 1;").last()

        assertTrue(remote.contains("base64 -d | sqlite3 -csv -header"), remote)
        assertTrue(remote.contains("\"file:$db?mode=ro\""), remote)
        assertTrue(remote.startsWith("su -c '"), remote)
    }

    @Test
    fun `falls back to the adb found on this machine when no path is configured`() {
        val command = sqlite(adbPath = null).command("select 1;")

        assertTrue(command.first().endsWith("adb") || command.first().endsWith("adb.exe"), command.first())
    }

    @Test
    fun `refuses a database path that would break out of the quoted command`() {
        val sqlite = AdbSqlite(udid = "127.0.0.1:5555", adbPath = "adb", databasePath = "/tmp/it's.db")

        assertFailsWith<IllegalArgumentException> { sqlite.command("select 1;") }
    }

    @Test
    fun `turns a successful run into rows`() {
        val rows = AdbSqlite.toRows(exitCode = 0, stdout = "a,b\r\n1,x\r\n", stderr = "")

        assertEquals(1, rows.size)
        assertEquals("x", rows[0].string("b"))
    }

    @Test
    fun `reports the sqlite error instead of returning an empty result`() {
        val error = assertFailsWith<IllegalStateException> {
            AdbSqlite.toRows(exitCode = 1, stdout = "", stderr = "Error: near line 1: no such table: nope")
        }

        assertTrue(error.message!!.contains("no such table: nope"), error.message!!)
    }

    @Test
    fun `treats an Error line on stdout as a failure even when the exit code is zero`() {
        // 'adb exec-out' and some su builds swallow the exit code — the text is the only signal left.
        val error = assertFailsWith<IllegalStateException> {
            AdbSqlite.toRows(exitCode = 0, stdout = "Error: near line 1: syntax error\r\n", stderr = "")
        }

        assertTrue(error.message!!.contains("syntax error"), error.message!!)
    }

    @Test
    fun `surfaces a missing root shell as a failure`() {
        val error = assertFailsWith<IllegalStateException> {
            AdbSqlite.toRows(exitCode = 127, stdout = "", stderr = "/system/bin/sh: su: not found")
        }

        assertTrue(error.message!!.contains("su: not found"), error.message!!)
    }
}
