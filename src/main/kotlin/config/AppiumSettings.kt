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

    val adbPath: String?,

    val autoConnectAdb: Boolean,
) {

    fun describe(): String =
        "serverUrl=$serverUrl, udid=$udid, deviceName=$deviceName, platformVersion=$platformVersion, " +
            "app=$appPackage/$appActivity, systemPort=$systemPort, autoConnectAdb=$autoConnectAdb"

    companion object {
        fun from(config: ApplicationConfig): AppiumSettings {
            val util = ConfigUtil(config, "appium")
            return AppiumSettings(
                serverUrl = util.requireText("serverUrl"),
                deviceName = util.requireText("deviceName"),
                udid = util.text("udid"),
                platformVersion = util.text("platformVersion"),
                appPackage = util.requireText("appPackage"),
                appActivity = util.requireText("appActivity"),
                systemPort = util.int("systemPort"),
                newCommandTimeout = util.requireSeconds("newCommandTimeoutSeconds"),
                implicitWait = util.requireSeconds("implicitWaitSeconds"),
                adbExecTimeout = util.requireSeconds("adbExecTimeoutSeconds"),
                autoConnectAdb = util.bool("autoConnectAdb") ?: true,
                adbPath = util.text("adbPath")
            )
        }
    }
}
