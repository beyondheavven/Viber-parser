package com.viber.device.adb

import com.viber.appium.AdbConnector
import com.viber.device.SqlExecutor
import com.viber.device.sqlite.Row
import com.viber.device.sqlite.SqliteCsv
import org.slf4j.LoggerFactory
import java.time.Duration
import java.util.Base64

/**
 * Выполняет SELECT прямо на устройстве: `adb shell -T` поднимает root-шелл, тот скармливает
 * запрос устройскому sqlite3, наружу приходит CSV.
 *
 * Почему именно так:
 * - `shell -T` (а не `exec-out`) — только он доносит exit code и держит stderr отдельно
 *   от stdout, иначе провалившийся запрос неотличим от пустого результата;
 * - SQL едет base64 — в команде остаются только `[A-Za-z0-9+/=]`, поэтому кавычки и
 *   переводы строк внутри запроса не могут развалить ни shell устройства, ни quoting
 *   ProcessBuilder на Windows;
 * - база открывается через `file:...?mode=ro` — Viber работает с ней в это же время,
 *   и трогать её на запись мы не имеем права. Флага `-readonly` у sqlite 3.22 нет.
 */
class AdbSqlite(
    private val udid: String,
    private val adbPath: String?,
    private val databasePath: String,
    private val timeout: Duration = Duration.ofSeconds(60),
) : SqlExecutor {

    private val logger = LoggerFactory.getLogger(AdbSqlite::class.java)

    override fun query(sql: String): List<Row> {
        val command = command(sql)
        logger.debug("Querying {} on {}: {}", databasePath, udid, sql.replace('\n', ' ').take(200))

        val output = AdbShell.run(command, timeout, "Query on $udid ($sql)")

        return toRows(output.exitCode, output.stdout, output.stderr)
    }

    internal fun command(sql: String): List<String> = listOf(
        AdbConnector.resolveAdbExecutable(adbPath),
        "-s", udid,
        "shell", "-T",
        remoteCommand(sql, databasePath),
    )

    companion object {

        internal fun remoteCommand(sql: String, databasePath: String): String {
            require(!databasePath.contains('\'')) { "Database path must not contain a quote: $databasePath" }
            val payload = Base64.getEncoder().encodeToString(sql.toByteArray())
            return "su -c 'echo $payload | base64 -d | sqlite3 -csv -header \"file:$databasePath?mode=ro\"'"
        }

        /**
         * sqlite печатает `Error: ...` и возвращает ненулевой код, но по дороге
         * (su, старый adbd) код теряется — поэтому проверяем и текст тоже.
         */
        internal fun toRows(exitCode: Int, stdout: String, stderr: String): List<Row> {
            val failure = stderr.trim().takeIf { it.isNotEmpty() }
                ?: stdout.lineSequence().firstOrNull { it.startsWith("Error:") }?.trim()

            if (exitCode != 0 || failure != null) {
                error("sqlite3 failed (exit $exitCode): ${failure ?: stdout.take(200)}")
            }
            return SqliteCsv.parse(stdout)
        }
    }
}

