package com.viber.device

import com.viber.appium.AdbConnector
import org.slf4j.LoggerFactory
import java.time.Duration

/**
 * Правка базы Viber прямо на устройстве.
 *
 * Зеркало [AdbSqlite], но путь на запись — это не «тот же запрос без `mode=ro`». Живую
 * базу держит работающий Viber: он кэширует страницы и при следующем сохранении затрёт
 * наши изменения, поэтому приложение сначала гасится. Порядок шагов внутри одной
 * su-команды:
 *
 * 1. `am force-stop` — Viber отпускает базу;
 * 2. `stat` — запоминаем uid:gid до того, как что-то тронули;
 * 3. `cp` — копия рядом; не получилось скопировать — не пишем вовсе;
 * 4. `sqlite3` — весь скрипт одной транзакцией, exit code сохраняем сразу;
 * 5. `chown` — база и её журналы возвращаются приложению. Это и есть причина шага 2:
 *    `-wal`, `-shm` и `-journal` создаёт sqlite3 от root, и Viber потом не откроет
 *    собственную базу;
 * 6. `am start` — приложение обратно, если о нём просили.
 *
 * Наружу отдаётся код sqlite3, а не последнего `am`: восстановление и запуск не должны
 * выдавать провалившуюся запись за успех.
 *
 * Сам скрипт едет **stdin**, а не в команде: команда у adb ограничена 4096 байтами
 * (см. [AdbShell]), а 129 участников дают ~21 КБ UPDATE'ов. Раньше он уезжал base64 прямо
 * в `su -c` — на маленькой группе это работало, на настоящей давало `exit 255` с пустой
 * ошибкой. Побочная выгода: SQL вообще не попадает в командную строку, поэтому кавычки и
 * переводы строк в нём не могут развалить ни shell устройства, ни quoting на Windows.
 */
class AdbSqliteWriter(
    private val udid: String,
    private val adbPath: String?,
    private val databasePath: String,
    private val appPackage: String,
    private val appActivity: String,
    private val backup: Boolean = true,
    private val timeout: Duration = Duration.ofSeconds(120),
) : SqlWriter {

    private val logger = LoggerFactory.getLogger(AdbSqliteWriter::class.java)

    private val backupPath: String get() = databasePath + BACKUP_SUFFIX

    override fun execute(statements: List<String>, restartApp: Boolean): WriteResult {
        val command = command(statements, restartApp)
        logger.info("Applying {} statement(s) to {} on {}", statements.size, databasePath, udid)

        val output = AdbShell.run(
            command = command,
            timeout = timeout,
            what = "Write to $databasePath on $udid",
            stdin = script(statements),
        )

        return WriteResult(
            changedRows = changedRows(output.exitCode, output.stdout, output.stderr),
            backupPath = backupPath.takeIf { backup },
        )
    }

    internal fun command(statements: List<String>, restartApp: Boolean): List<String> = listOf(
        AdbConnector.resolveAdbExecutable(adbPath),
        "-s", udid,
        "shell", "-T",
        remoteCommand(statements, restartApp),
    )

    /**
     * Команда не зависит от числа стейтментов — они придут отдельно, в stdin. Это не
     * стилистика: команда, растущая со списком участников, упирается в лимит adb.
     */
    private fun remoteCommand(statements: List<String>, restartApp: Boolean): String {
        require(statements.isNotEmpty()) { "Nothing to write: no statements" }
        listOf(databasePath, appPackage, appActivity).forEach { shellSafe(it) }

        val restart = "am start -n $appPackage/$appActivity >/dev/null 2>&1"
        val steps = buildList {
            add("am force-stop $appPackage >/dev/null 2>&1")
            add("owner=\$(stat -c %u:%g \"$databasePath\" 2>/dev/null)")
            if (backup) {
                // Без копии не пишем: восстановиться из неё — единственный способ откатить
                // правку живой базы, если что-то пойдёт не так уже после COMMIT. Но Viber
                // к этому моменту уже погашен, поэтому выходим не молча: неудачная попытка
                // не должна оставить приложение лежать.
                val giveUp = if (restartApp) "{ $restart; exit 1; }" else "exit 1"
                add("cp -f \"$databasePath\" \"$backupPath\" || $giveUp")
            }
            // Без SQL-аргумента sqlite3 читает скрипт со своего stdin — то есть с нашего.
            add("sqlite3 \"$databasePath\"")
            // Код запоминаем сразу, чтобы поднять приложение и всё равно отчитаться о провале.
            add("code=\$?")
            add("[ -n \"\$owner\" ] && chown \$owner ${journals().joinToString(" ")} >/dev/null 2>&1")
            if (restartApp) add(restart)
            add("exit \$code")
        }
        return "su -c '${steps.joinToString("; ")}'"
    }

    /**
     * Всё, что после нас может остаться принадлежащим root: сама база, журналы, которые
     * sqlite3 создаёт рядом, и копия. Существующим файлам владельца не меняет никто —
     * ломаются именно новые.
     */
    private fun journals(): List<String> = buildList {
        add(databasePath)
        add("$databasePath-wal")
        add("$databasePath-shm")
        add("$databasePath-journal")
        if (backup) add(backupPath)
    }.map { "\"$it\"" }

    private fun shellSafe(value: String) {
        require(!value.contains('\'') && !value.contains('"')) {
            "Value must not contain a quote, it would break out of the remote command: $value"
        }
    }

    companion object {

        const val BACKUP_SUFFIX = ".bak"

        /**
         * Одна транзакция на весь прогон: половина переписанных карточек хуже, чем ни одной.
         * `total_changes()` в конце — способ узнать, сколько строк база изменила на самом
         * деле; своим стейтментам верить нельзя, `_id` мог и не найтись.
         */
        internal fun script(statements: List<String>): String =
            (listOf("begin;") + statements + listOf("commit;", "select total_changes();"))
                .joinToString("\n", postfix = "\n")

        /**
         * Разбор результата записи. Провал ищем так же, как в [AdbSqlite]: exit code теряется
         * по дороге через su, поэтому строка `Error:` — такой же сигнал, как ненулевой код.
         *
         * @return сколько строк изменила база, или null — если числа в выводе не оказалось.
         */
        internal fun changedRows(exitCode: Int, stdout: String, stderr: String): Int? {
            val failure = stderr.trim().takeIf { it.isNotEmpty() }
                ?: stdout.lineSequence().firstOrNull { it.startsWith("Error:") }?.trim()

            if (exitCode != 0 || failure != null) {
                // Пустой вывод при ненулевом коде — обычно не sqlite3: так выглядит команда,
                // не доехавшая до устройства. Молчать об этом нельзя, иначе диагноз не с чего ставить.
                val detail = failure ?: stdout.take(200).ifBlank { "no output from the device at all" }
                error("sqlite3 write failed (exit $exitCode): $detail")
            }
            return stdout.lineSequence().map { it.trim() }.lastOrNull { it.toIntOrNull() != null }?.toInt()
        }
    }
}
