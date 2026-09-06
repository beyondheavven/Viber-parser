package com.viber.config

import com.viber.config.util.ConfigUtil
import io.ktor.server.config.ApplicationConfig

class FridaSettings(config: ConfigUtil) {

    val host: String = config.requireText("host")

    val port: Int = config.requireInt("port")

    val bridgeScriptPath: String = config.text("bridgeScriptPath") ?: "/scripts/frida_bridge.py"

    companion object {
        fun from(config: ApplicationConfig): FridaSettings {
            return FridaSettings(ConfigUtil(config, "frida"))
        }
    }
}