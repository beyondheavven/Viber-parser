package com.viber.config

import com.viber.config.util.ConfigUtil
import io.ktor.server.config.ApplicationConfig

class AdbSettings(config: ConfigUtil) {
    val host: String = config.requireText("host")

    val port: Int = config.requireInt("port")

    val connectRetries: Int = config.int("connectRetries") ?: 30

    companion object {
        fun from(config: ApplicationConfig): AdbSettings {
            return AdbSettings(ConfigUtil(config, "adb"))
        }
    }

}