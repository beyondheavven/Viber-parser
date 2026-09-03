package com.viber.config

import io.ktor.server.config.ApplicationConfig
import java.time.Duration


private const val DEFAULT_DATABASE_PATH = "/data/data/com.viber.voip/databases/viber_messages"

data class DatabaseSettings(
    val databasePath: String = DEFAULT_DATABASE_PATH,
    val queryTimeout: Duration = Duration.ofSeconds(60),
) {
    fun describe(): String = "path=$databasePath, queryTimeout=${queryTimeout.seconds}s"

    companion object {
        fun from(config: ApplicationConfig): DatabaseSettings {
            val defaults = DatabaseSettings()
            val util = ConfigUtil(config, "database")

            return DatabaseSettings(
                databasePath = util.text("path") ?: defaults.databasePath,
                queryTimeout = util.seconds("queryTimeoutSeconds") ?: defaults.queryTimeout,
            )
        }
    }
}
