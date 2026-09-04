package com.viber.config

import io.ktor.server.config.ApplicationConfig
import java.time.Duration

/**
 * Что и как долго читаем на устройстве. Само подключение (udid, путь к adb) живёт в
 * [AppiumSettings] — устройство у нас одно, и дублировать его адрес в двух секциях
 * значило бы завести два источника правды.
 */
data class DatabaseSettings(
    val databasePath: String = DEFAULT_DATABASE_PATH,
    val queryTimeout: Duration = Duration.ofSeconds(60),
    val writeTimeout: Duration = Duration.ofSeconds(120),
    val backupOnWrite: Boolean = true,
) {

    fun describe(): String = "path=$databasePath, queryTimeout=${queryTimeout.seconds}s, " +
        "writeTimeout=${writeTimeout.seconds}s, backupOnWrite=$backupOnWrite"

    companion object {
        const val DEFAULT_DATABASE_PATH = "/data/data/com.viber.voip/databases/viber_messages"

        private const val SECTION = "database"

        fun from(config: ApplicationConfig): DatabaseSettings {
            val defaults = DatabaseSettings()
            return DatabaseSettings(
                databasePath = config.text("path") ?: defaults.databasePath,
                queryTimeout = config.seconds("queryTimeoutSeconds") ?: defaults.queryTimeout,
                writeTimeout = config.seconds("writeTimeoutSeconds") ?: defaults.writeTimeout,
                backupOnWrite = config.text("backupOnWrite")?.toBooleanStrictOrNull() ?: defaults.backupOnWrite,
            )
        }

        private fun ApplicationConfig.text(key: String): String? =
            propertyOrNull("$SECTION.$key")?.getString()?.trim()?.takeIf { it.isNotEmpty() }

        private fun ApplicationConfig.seconds(key: String): Duration? =
            text(key)?.toLongOrNull()?.let(Duration::ofSeconds)
    }
}
