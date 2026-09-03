package com.viber.config

import com.viber.config.util.ConfigUtil
import io.ktor.server.config.ApplicationConfig

data class SupabaseSettings(
    val url: String,
    val key: String
) {

    fun describe(): String = "url=$url"

    companion object {
        fun from(config: ApplicationConfig): SupabaseSettings {
            val util = ConfigUtil(config, "supabase")
            return SupabaseSettings(
                url = util.requireText("url"),
                key = util.requireText("key")
            )
        }
    }
}