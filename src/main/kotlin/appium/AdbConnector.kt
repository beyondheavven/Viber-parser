package com.viber.appium

import org.slf4j.LoggerFactory
import java.io.File
import java.util.concurrent.TimeUnit

/**
 * Тонкая обёртка над `adb connect`. LDPlayer публикует устройство как сетевой adb-таргет
 * (`127.0.0.1:5555`) и после перезапуска эмулятора связь нужно поднимать заново, иначе
 * Appium стартует сессию против отсутствующего udid.
 */
object AdbConnector {

    private val logger = LoggerFactory.getLogger(AdbConnector::class.java)

    private val NETWORK_TARGET = Regex("""^[^\s:]+:\d{1,5}$""")

    private const val CONNECT_TIMEOUT_SECONDS = 20L

    /** `adb connect` имеет смысл только для таргетов вида host:port. */
    fun isNetworkTarget(udid: String): Boolean = NETWORK_TARGET.matches(udid)

    /**
     * Каталоги, где обычно лежит adb. Порядок = приоритет.
     *
     * Полагаться на PATH и ANDROID_HOME недостаточно: Gradle переиспользует демон, и
     * форкнутый `run` наследует окружение того процесса, который демон поднял — там
     * переменных Android SDK может не быть вовсе.
     */
    fun defaultSearchRoots(
        androidHome: String? = System.getenv("ANDROID_HOME"),
        androidSdkRoot: String? = System.getenv("ANDROID_SDK_ROOT"),
        localAppData: String? = System.getenv("LOCALAPPDATA"),
        programFiles: String? = System.getenv("ProgramFiles"),
    ): List<String> = buildList {
        androidHome.dir("platform-tools")?.let(::add)
        androidSdkRoot.dir("platform-tools")?.let(::add)
        localAppData.dir("Android", "Sdk", "platform-tools")?.let(::add)
        // LDPlayer кладёт собственный adb.exe рядом с эмулятором.
        add(File("C:/LDPlayer/LDPlayer9").path)
        add(File("C:/LDPlayer/LDPlayer64").path)
        programFiles.dir("LDPlayer", "LDPlayer9")?.let(::add)
    }.distinct()

    /**
     * Путь к adb: явная настройка → первый [searchRoots], где реально лежит бинарь →
     * `adb` из PATH как последняя попытка.
     */
    fun resolveAdbExecutable(
        configured: String?,
        searchRoots: List<String> = defaultSearchRoots(),
    ): String {
        configured?.trim()?.takeIf { it.isNotEmpty() }?.let { return it }

        val binaryName = if (isWindows()) "adb.exe" else "adb"
        searchRoots.forEach { root ->
            val candidate = File(root, binaryName)
            if (candidate.isFile) return candidate.absolutePath
        }
        return "adb"
    }

    /**
     * Пытается подключить устройство. Не бросает: недоступный adb не должен ронять
     * старт сессии — Appium всё равно попробует свой путь и выдаст свою ошибку.
     *
     * @return true, если adb отчитался об установленном (или уже существующем) соединении.
     */
    fun ensureConnected(udid: String, adbPath: String?): Boolean {
        if (!isNetworkTarget(udid)) {
            logger.debug("udid '$udid' is not a network target, skipping 'adb connect'")
            return true
        }

        val adb = resolveAdbExecutable(adbPath)
        logger.debug("Using adb at '$adb'")
        return try {
            val process = ProcessBuilder(adb, "connect", udid)
                .redirectErrorStream(true)
                .start()

            if (!process.waitFor(CONNECT_TIMEOUT_SECONDS, TimeUnit.SECONDS)) {
                process.destroyForcibly()
                logger.warn("'$adb connect $udid' timed out after $CONNECT_TIMEOUT_SECONDS s")
                return false
            }

            val output = process.inputStream.bufferedReader().readText().trim()
            val connected = output.contains("connected to", ignoreCase = true)
            if (connected) {
                logger.info("adb ($adb): $output")
            } else {
                logger.warn("'$adb connect $udid' did not confirm a connection: $output")
            }
            connected
        } catch (e: Exception) {
            logger.warn("Could not run '$adb connect $udid' — set ADB_PATH to point at an adb binary", e)
            false
        }
    }

    private fun String?.dir(vararg segments: String): String? =
        this?.trim()?.takeIf { it.isNotEmpty() }
            ?.let { base -> segments.fold(File(base), ::File).path }

    private fun isWindows(): Boolean =
        System.getProperty("os.name").orEmpty().startsWith("Windows", ignoreCase = true)
}
