package com.viber.config

import io.ktor.server.config.ApplicationConfig
import java.time.Duration

data class AppiumSettings(
    val serverUrl: String,

    val deviceName: String,

    val udid: String?,

    val platformVersion: String?,

    val appPackage: String,

    val appActivity: String,

    val systemPort: Int?,

    val newCommandTimeout: Duration,

    val implicitWait: Duration,

    val adbExecTimeout: Duration,

    val serverLaunchTimeout: Duration,

    val adbPath: String?,

    val autoConnectAdb: Boolean,
) {

    fun describe(): String =
        "serverUrl=$serverUrl, udid=$udid, deviceName=$deviceName, platformVersion=$platformVersion, " +
            "app=$appPackage/$appActivity, systemPort=$systemPort, autoConnectAdb=$autoConnectAdb"

    companion object {
        fun from(config: ApplicationConfig): AppiumSettings {
            return AppiumSettings(
                serverUrl = config.requireText("serverUrl"),
                deviceName = config.requireText("deviceName"),
                udid = config.text("udid"),
                platformVersion = config.text("platformVersion"),
                appPackage = config.requireText("appPackage"),
                appActivity = config.requireText("appActivity"),
                systemPort = config.int("systemPort"),
                newCommandTimeout = config.requireSeconds("newCommandTimeoutSeconds"),
                implicitWait = config.requireSeconds("implicitWaitSeconds"),
                adbExecTimeout = config.requireSeconds("adbExecTimeoutSeconds"),
                autoConnectAdb = config.bool("autoConnectAdb") ?: true,
                serverLaunchTimeout = config.requireSeconds("serverLaunchTimeoutSeconds"),
                adbPath = config.text("adbPath")
            )
        }

        private fun ApplicationConfig.text(key: String): String? {
            val raw = propertyOrNull("appium.$key")?.getString()?.trim() ?: return null

            if (raw.startsWith("$") && raw.contains(":")) {
                val envVarName = raw.substringAfter("$").substringBefore(":")
                val yamlDefault = raw.substringAfter(":")
                return System.getenv(envVarName)?.takeIf { it.isNotEmpty() } ?: yamlDefault
            }
            return raw.takeIf { it.isNotEmpty() }
        }

        private fun ApplicationConfig.requireText(key: String): String =
            text(key) ?: throw IllegalArgumentException("Missing required config: appium.$key")

        private fun ApplicationConfig.requireSeconds(key: String): Duration =
            text(key)?.toLongOrNull()?.let(Duration::ofSeconds)
                ?: throw IllegalArgumentException("Missing or invalid time config: appium.$key")

        private fun ApplicationConfig.int(key: String): Int? = text(key)?.toIntOrNull()

        private fun ApplicationConfig.bool(key: String): Boolean? = text(key)?.toBooleanStrictOrNull()
    }
}
