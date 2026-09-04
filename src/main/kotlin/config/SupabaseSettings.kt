package com.viber.config

import com.viber.config.util.ConfigUtil
import io.ktor.server.config.ApplicationConfig

data class SupabaseSettings(
    val url: String,
    val key: String
) {

    fun describe(): String = "url=$url"

    override fun toString(): String = describe()

    companion object {
        fun from(config: ApplicationConfig): SupabaseSettings? {
            val util = ConfigUtil(config, "supabase")
            val url = util.text("url")?.takeIf { it.isNotBlank() }
            val key = util.text("key")?.takeIf { it.isNotBlank() }

            // Пусто и то и другое — Supabase просто выключен, это не ошибка.
            if (url == null && key == null) return null

            require(url != null) { missing("supabase.url") }
            require(key != null) { missing("supabase.key") }

            return SupabaseSettings(url, key)
        }

        private fun missing(key: String): String =
            "Missing required config: $key — supabase.url and supabase.key must be set together " +
                "(leave both empty to disable Supabase)"
    }
}
