package com.viber.config.util

import io.ktor.server.config.ApplicationConfig
import java.time.Duration

class ConfigUtil(
    private val config: ApplicationConfig,
    private val prefix: String,
) {
    fun text(key: String): String?{
        val fullKey = "$prefix.$key"
        val raw = config.propertyOrNull(fullKey)?.getString()?.trim() ?: return null

        if (raw.startsWith("$") && raw.contains(":")) {
            val envVarName = raw.substringAfter("$").substringBefore(":")
            val yamlDefault = raw.substringAfter(":")
            return System.getenv(envVarName)?.takeIf { it.isNotEmpty()} ?: yamlDefault
        }

        return raw.takeIf { it.isNotEmpty() }
    }

    fun requireText(key: String): String = text(key) ?: throw IllegalArgumentException("Missing required config: $prefix.$key")

    fun requireInt(key: String): Int = int(key) ?: throw IllegalArgumentException("Missing or invalid int config: $prefix.$key")

    fun seconds(key: String): Duration? = text(key)?.toLongOrNull()?.let { Duration.ofSeconds(it) }

    fun requireSeconds(key: String): Duration = seconds(key) ?: throw IllegalArgumentException("Missing or invalid time config: $prefix.$key")

    fun int(key: String): Int? = text(key)?.toIntOrNull()

    fun bool(key: String): Boolean? = text(key)?.toBooleanStrictOrNull()

}