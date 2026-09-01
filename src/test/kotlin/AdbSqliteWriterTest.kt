package com.viber

import com.viber.device.AdbSqliteWriter
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class AdbSqliteWriterTest {

    private val db = "/data/data/com.viber.voip/databases/viber_messages"

    private val update = "update participants_info set member_id = 'GPMvIMhWouQ=' where _id = 7;"

    private fun writer(backup: Boolean = true) = AdbSqliteWriter(
        udid = "127.0.0.1:5555",
        adbPath = "adb",
        databasePath = db,
        appPackage = "com.viber.voip",
        appActivity = "com.viber.voip.WelcomeActivity",
        backup = backup,
    )

    private fun remote(
        restartApp: Boolean = true,
        backup: Boolean = true,
    ) = writer(backup).command(listOf(update), restartApp).last()

    @Test
    fun `runs over 'adb shell -T' just like the read path`() {
        val command = writer().command(listOf(update), restartApp = true)

        assertEquals("adb", command.first())
        assertEquals(listOf("-s", "127.0.0.1:5555", "shell", "-T"), command.subList(1, 5))
        assertEquals(6, command.size)
    }

    @Test
    fun `stops Viber before touching the database and starts it again afterwards`() {
        val remote = remote()

        val stop = remote.indexOf("am force-stop com.viber.voip")
        val sqlite = remote.indexOf("sqlite3")
        // lastIndexOf, а не indexOf: раньше по скрипту стоит ещё один am start — тот,
        // которым мы поднимаем Viber, если не удалось снять копию.
        val start = remote.lastIndexOf("am start -n com.viber.voip/com.viber.voip.WelcomeActivity")

        assertTrue(stop >= 0, remote)
        assertTrue(stop < sqlite, "force-stop must come before sqlite3: $remote")
        assertTrue(sqlite < start, "am start must come after sqlite3: $remote")
    }

    @Test
    fun `keeps Viber closed when the caller asked not to restart it`() {
        val remote = remote(restartApp = false)

        assertTrue(remote.contains("am force-stop"), remote)
        assertFalse(remote.contains("am start"), remote)
    }

    @Test
    fun `copies the database aside before the first statement runs`() {
        val remote = remote()

        val copy = remote.indexOf("cp -f \"$db\" \"$db${AdbSqliteWriter.BACKUP_SUFFIX}\"")
        assertTrue(copy >= 0, remote)
        assertTrue(copy < remote.indexOf("sqlite3"), remote)
        // Без копии писать нельзя — падение cp обязано остановить всё до записи.
        assertTrue(remote.contains("|| { am start -n com.viber.voip/com.viber.voip.WelcomeActivity"), remote)
    }

    @Test
    fun `brings Viber back even when the backup could not be made`() {
        val remote = remote()

        // К моменту cp приложение уже погашено: выйти молча значило бы оставить его лежать.
        val giveUp = Regex("""\|\| \{ am start[^}]*; exit 1; }""").find(remote)
        assertTrue(giveUp != null, "the cp failure branch must restart Viber before giving up: $remote")
        assertTrue(giveUp.range.first < remote.indexOf("sqlite3"), remote)
    }

    @Test
    fun `brings Viber back even when the write itself failed`() {
        val remote = remote()

        // am start стоит после code=$?, поэтому провал sqlite3 его не пропускает,
        // но и не выдаётся за успех — наружу всё равно уходит код sqlite3.
        val saved = remote.indexOf("code=$?")
        val start = remote.indexOf("am start", saved)
        assertTrue(saved >= 0 && start > saved, remote)
        assertTrue(remote.trimEnd().endsWith("exit \$code'"), remote)
    }

    @Test
    fun `does not restart Viber from the failure branch when asked not to restart it`() {
        val remote = remote(restartApp = false)

        assertTrue(remote.contains("|| exit 1"), remote)
        assertFalse(remote.contains("am start"), remote)
    }

    @Test
    fun `skips the backup when it is switched off`() {
        assertFalse(remote(backup = false).contains("cp -f"), remote(backup = false))
    }

    @Test
    fun `opens the database for writing, not read-only`() {
        val remote = remote()

        assertTrue(remote.contains("sqlite3 \"$db\""), remote)
        assertFalse(remote.contains("mode=ro"), remote)
    }

    @Test
    fun `wraps the statements in one transaction`() {
        val script = AdbSqliteWriter.script(listOf("update a;", "update b;"))

        assertTrue(script.startsWith("begin;"), script)
        assertTrue(script.contains("update a;\nupdate b;"), script)
        assertTrue(script.contains("commit;"), script)
        // Число реально изменённых строк спрашиваем у самой базы, а не считаем по своим стейтментам.
        assertTrue(script.trimEnd().endsWith("select total_changes();"), script)
    }

    @Test
    fun `sends the script on stdin instead of putting it in the command`() {
        val remote = remote()

        // sqlite3 без SQL-аргумента читает скрипт со стандартного ввода.
        assertTrue(remote.contains("sqlite3 \"$db\";"), remote)
        assertFalse(remote.contains("base64"), remote)
        assertFalse(remote.contains(update), "the SQL must not appear in the command: $remote")
    }

    @Test
    fun `keeps the command the same size no matter how many rows are written`() {
        // Регрессия: adb ограничивает команду 4096 байтами (shell:<cmd>), и скрипт,
        // уезжавший в ней, на 129 участниках давал exit 255 с пустой ошибкой.
        val one = writer().command(listOf(update), restartApp = true).last()
        val many = writer().command(List(500) { update }, restartApp = true).last()

        assertEquals(one, many)
        assertTrue(one.length < 1024, "the command must stay far below adb's 4096 limit: ${one.length}")
    }

    @Test
    fun `hands the database and its journals back to Viber's uid`() {
        val remote = remote()

        assertTrue(remote.contains("stat -c %u:%g"), remote)
        val chown = remote.indexOf("chown")
        assertTrue(chown > remote.indexOf("sqlite3"), "chown must run after sqlite3: $remote")
        listOf("$db-wal", "$db-shm", "$db-journal", "$db${AdbSqliteWriter.BACKUP_SUFFIX}").forEach {
            assertTrue(remote.contains("\"$it\""), "chown must cover $it: $remote")
        }
    }

    @Test
    fun `keeps the sqlite exit code even though it restarts Viber afterwards`() {
        val remote = remote()

        assertTrue(remote.contains("code=$?"), remote)
        assertTrue(remote.trimEnd().endsWith("exit \$code'"), remote)
    }

    @Test
    fun `refuses a database path or package that would break out of the quoted command`() {
        assertFailsWith<IllegalArgumentException> {
            AdbSqliteWriter(
                udid = "127.0.0.1:5555",
                adbPath = "adb",
                databasePath = "/tmp/it's.db",
                appPackage = "com.viber.voip",
                appActivity = "com.viber.voip.WelcomeActivity",
            ).command(listOf(update), restartApp = true)
        }
        assertFailsWith<IllegalArgumentException> {
            AdbSqliteWriter(
                udid = "127.0.0.1:5555",
                adbPath = "adb",
                databasePath = db,
                appPackage = "com.viber'voip",
                appActivity = "com.viber.voip.WelcomeActivity",
            ).command(listOf(update), restartApp = true)
        }
    }

    @Test
    fun `refuses to run without a single statement`() {
        assertFailsWith<IllegalArgumentException> { writer().command(emptyList(), restartApp = true) }
    }

    @Test
    fun `reads back how many rows the device actually changed`() {
        assertEquals(83, AdbSqliteWriter.changedRows(exitCode = 0, stdout = "83\r\n", stderr = ""))
    }

    @Test
    fun `does not invent a number when the device printed none`() {
        assertNull(AdbSqliteWriter.changedRows(exitCode = 0, stdout = "", stderr = ""))
    }

    @Test
    fun `says something useful when the device failed without a word`() {
        // Так выглядит команда, не доехавшая до устройства: код есть, объяснения нет.
        val error = assertFailsWith<IllegalStateException> {
            AdbSqliteWriter.changedRows(exitCode = 255, stdout = "", stderr = "")
        }

        assertTrue(error.message!!.contains("255"), error.message!!)
        assertTrue(error.message!!.contains("no output"), error.message!!)
    }

    @Test
    fun `reports a failed write instead of returning silently`() {
        val error = assertFailsWith<IllegalStateException> {
            AdbSqliteWriter.changedRows(exitCode = 1, stdout = "", stderr = "Error: attempt to write a readonly database")
        }

        assertTrue(error.message!!.contains("readonly"), error.message!!)
    }

    @Test
    fun `treats an Error line on stdout as a failed write even when the exit code is zero`() {
        val error = assertFailsWith<IllegalStateException> {
            AdbSqliteWriter.changedRows(exitCode = 0, stdout = "Error: database is locked\r\n", stderr = "")
        }

        assertTrue(error.message!!.contains("locked"), error.message!!)
    }
}
