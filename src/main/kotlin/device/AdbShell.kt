package com.viber.device

import java.time.Duration
import java.util.concurrent.TimeUnit

/**
 * Запуск adb как процесса. Общее у чтения и записи: обе стороны ходят на устройство
 * через `adb shell -T` и обеим нужны exit code и stderr отдельно от stdout.
 *
 * **Команда не может быть длинной.** adb передаёт её как имя сервиса (`shell:<cmd>`), а
 * оно ограничено 4096 байтами: на устройстве проверено, что 3.3 КБ проходят, а 4.2 КБ
 * дают `exit 255` с пустыми stdout и stderr — то есть провал неотличим от «команда
 * ничего не сказала». Всё, что может вырасти с числом строк, обязано ехать [stdin], а не
 * в команде.
 */
internal object AdbShell {

    data class Output(val exitCode: Int, val stdout: String, val stderr: String)

    fun run(command: List<String>, timeout: Duration, what: String, stdin: String? = null): Output {
        val process = ProcessBuilder(command).start()

        // Пишем в отдельном потоке: скрипт может не поместиться в буфер трубы, и пока мы
        // его дописываем, устройство уже пишет нам в stdout. Читая только после записи,
        // мы бы дождались взаимной блокировки. Закрытие потока — это EOF для sqlite3.
        val feeder = Thread {
            process.outputStream.use { out ->
                stdin?.let { out.write(it.toByteArray()) }
            }
        }.apply { isDaemon = true; start() }

        // Оба потока читаем до waitFor: полный буфер трубы иначе подвесит устройство.
        val stdout = process.inputStream.bufferedReader().readText()
        val stderr = process.errorStream.bufferedReader().readText()

        if (!process.waitFor(timeout.seconds, TimeUnit.SECONDS)) {
            process.destroyForcibly()
            error("$what timed out after ${timeout.seconds}s")
        }
        feeder.join(timeout.toMillis())

        return Output(process.exitValue(), stdout, stderr)
    }
}
