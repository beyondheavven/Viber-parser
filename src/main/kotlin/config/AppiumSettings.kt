package com.viber.config

import io.ktor.server.config.ApplicationConfig
import java.time.Duration

/**
 * Настройки подключения к устройству и Appium-серверу.
 *
 * Дефолты рассчитаны на LDPlayer 9 (Android 9 / API 28): эмулятор поднимает adb-мост
 * на 127.0.0.1:5555, поэтому [udid] задан именно так, а не как `emulator-5554`.
 * Значения переопределяются в `application.yaml` (секция `appium`) и переменными
 * окружения, подставляемыми в этот же yaml.
 */
data class AppiumSettings(
    val serverUrl: String = DEFAULT_SERVER_URL,
    val deviceName: String = DEFAULT_DEVICE_NAME,
    val udid: String? = DEFAULT_UDID,
    val platformVersion: String? = DEFAULT_PLATFORM_VERSION,
    val appPackage: String = DEFAULT_APP_PACKAGE,
    val appActivity: String = DEFAULT_APP_ACTIVITY,
    val systemPort: Int? = null,
    val newCommandTimeout: Duration = Duration.ofMinutes(5),
    val implicitWait: Duration = Duration.ofSeconds(10),
    val adbExecTimeout: Duration = Duration.ofSeconds(60),
    val serverLaunchTimeout: Duration = Duration.ofSeconds(120),
    val adbPath: String? = null,
    val autoConnectAdb: Boolean = true,
) {

    /** Строка для логов без лишнего шума — сюда смотрят, когда сессия не поднялась. */
    fun describe(): String =
        "serverUrl=$serverUrl, udid=$udid, deviceName=$deviceName, platformVersion=$platformVersion, " +
            "app=$appPackage/$appActivity, systemPort=$systemPort, autoConnectAdb=$autoConnectAdb"

    companion object {
        const val DEFAULT_SERVER_URL = "http://127.0.0.1:4723"
        const val DEFAULT_DEVICE_NAME = "LDPlayer"
        const val DEFAULT_UDID = "127.0.0.1:5555"
        const val DEFAULT_PLATFORM_VERSION = "9"
        const val DEFAULT_APP_PACKAGE = "com.viber.voip"
        const val DEFAULT_APP_ACTIVITY = "com.viber.voip.WelcomeActivity"

        private const val SECTION = "appium"

        /**
         * Читает секцию `appium` из корневого конфига приложения. Отсутствующие и пустые
         * значения падают в дефолты: пустая переменная окружения не должна «выигрывать»
         * у осмысленного значения по умолчанию.
         */
        fun from(config: ApplicationConfig): AppiumSettings {
            val defaults = AppiumSettings()
            return AppiumSettings(
                serverUrl = config.text("serverUrl") ?: defaults.serverUrl,
                deviceName = config.text("deviceName") ?: defaults.deviceName,
                udid = config.optionalText("udid", defaults.udid),
                platformVersion = config.optionalText("platformVersion", defaults.platformVersion),
                appPackage = config.text("appPackage") ?: defaults.appPackage,
                appActivity = config.text("appActivity") ?: defaults.appActivity,
                systemPort = config.int("systemPort"),
                newCommandTimeout = config.seconds("newCommandTimeoutSeconds") ?: defaults.newCommandTimeout,
                implicitWait = config.seconds("implicitWaitSeconds") ?: defaults.implicitWait,
                adbExecTimeout = config.seconds("adbExecTimeoutSeconds") ?: defaults.adbExecTimeout,
                serverLaunchTimeout = config.seconds("serverLaunchTimeoutSeconds") ?: defaults.serverLaunchTimeout,
                adbPath = config.text("adbPath"),
                autoConnectAdb = config.text("autoConnectAdb")?.toBooleanStrictOrNull() ?: defaults.autoConnectAdb,
            )
        }

        /**
         * Для capability, которые можно не передавать вовсе: ключа в конфиге нет — берём
         * дефолт LDPlayer, ключ есть, но пустой — сознательное «не передавать».
         */
        private fun ApplicationConfig.optionalText(key: String, default: String?): String? =
            if (propertyOrNull("$SECTION.$key") == null) default else text(key)

        private fun ApplicationConfig.text(key: String): String? =
            propertyOrNull("$SECTION.$key")?.getString()?.trim()?.takeIf { it.isNotEmpty() }

        private fun ApplicationConfig.int(key: String): Int? = text(key)?.toIntOrNull()

        private fun ApplicationConfig.seconds(key: String): Duration? = text(key)?.toLongOrNull()?.let(Duration::ofSeconds)
    }
}
