package com.viber.config

import com.viber.config.util.ConfigUtil
import io.ktor.server.config.ApplicationConfig

class FridaSettings(config: ConfigUtil) {

    val serverPath: String = config.text("serverPath") ?: "/data/local/tmp/frida-server"

    val version: String = config.text("version") ?: "0.0.1"

    val deviceName: String = config.text("deviceName") ?: "Unknown"

    companion object {
        fun from(config: ApplicationConfig): FridaSettings {
            return FridaSettings(ConfigUtil(config, "frida"))
        }
    }
}