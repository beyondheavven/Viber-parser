package com.viber.config

import com.viber.config.util.ConfigUtil
import io.ktor.server.config.ApplicationConfig

class AutomationSettings(config: ConfigUtil) {
    val baseUrl: String = config.requireText("baseUrl")

    companion object {
        fun from(config: ApplicationConfig): AutomationSettings {
            return AutomationSettings(ConfigUtil(config, "automation"))
        }
    }
}