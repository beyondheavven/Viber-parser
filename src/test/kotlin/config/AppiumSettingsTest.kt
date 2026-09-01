package com.viber.config

import io.ktor.server.config.ApplicationConfig
import io.ktor.server.config.MapApplicationConfig
import io.ktor.server.config.yaml.YamlConfigLoader
import java.time.Duration
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class AppiumSettingsTest {

    @Test
    fun `falls back to LDPlayer defaults when the appium section is missing`() {
        val settings = AppiumSettings.from(MapApplicationConfig())

        assertEquals("http://127.0.0.1:4723", settings.serverUrl)
        assertEquals("127.0.0.1:5555", settings.udid)
        assertEquals("9", settings.platformVersion)
        assertEquals("com.viber.voip", settings.appPackage)
        assertEquals("com.viber.voip.WelcomeActivity", settings.appActivity)
        assertEquals(Duration.ofMinutes(5), settings.newCommandTimeout)
        assertEquals(Duration.ofSeconds(10), settings.implicitWait)
        assertTrue(settings.autoConnectAdb)
    }

    @Test
    fun `reads every property from the appium section`() {
        val config = MapApplicationConfig(
            "appium.serverUrl" to "http://192.168.1.10:4723",
            "appium.deviceName" to "LDPlayer-2",
            "appium.udid" to "127.0.0.1:5557",
            "appium.platformVersion" to "7.1.2",
            "appium.appPackage" to "com.example.app",
            "appium.appActivity" to "com.example.app.MainActivity",
            "appium.systemPort" to "8201",
            "appium.newCommandTimeoutSeconds" to "600",
            "appium.implicitWaitSeconds" to "3",
            "appium.adbExecTimeoutSeconds" to "90",
            "appium.serverLaunchTimeoutSeconds" to "150",
            "appium.adbPath" to "C:/LDPlayer/LDPlayer9/adb.exe",
            "appium.autoConnectAdb" to "false",
        )

        val settings = AppiumSettings.from(config)

        assertEquals("http://192.168.1.10:4723", settings.serverUrl)
        assertEquals("LDPlayer-2", settings.deviceName)
        assertEquals("127.0.0.1:5557", settings.udid)
        assertEquals("7.1.2", settings.platformVersion)
        assertEquals("com.example.app", settings.appPackage)
        assertEquals("com.example.app.MainActivity", settings.appActivity)
        assertEquals(8201, settings.systemPort)
        assertEquals(Duration.ofSeconds(600), settings.newCommandTimeout)
        assertEquals(Duration.ofSeconds(3), settings.implicitWait)
        assertEquals(Duration.ofSeconds(90), settings.adbExecTimeout)
        assertEquals(Duration.ofSeconds(150), settings.serverLaunchTimeout)
        assertEquals("C:/LDPlayer/LDPlayer9/adb.exe", settings.adbPath)
        assertEquals(false, settings.autoConnectAdb)
    }

    @Test
    fun `treats blank values as unset so an empty env var does not win`() {
        val config = MapApplicationConfig(
            "appium.serverUrl" to "  ",
            "appium.udid" to "",
            "appium.systemPort" to "",
        )

        val settings = AppiumSettings.from(config)

        assertEquals("http://127.0.0.1:4723", settings.serverUrl)
        assertNull(settings.udid)
        assertNull(settings.systemPort)
    }

    @Test
    fun `application yaml resolves to the LDPlayer bridge when no env overrides are set`() {
        val config: ApplicationConfig = YamlConfigLoader().load("application.yaml")
            ?: error("application.yaml is not on the test classpath")

        val settings = AppiumSettings.from(config)

        // Ломается, если env APPIUM_* заданы в окружении прогона — это ожидаемо.
        assertEquals("http://127.0.0.1:4723", settings.serverUrl)
        assertEquals("127.0.0.1:5555", settings.udid)
        assertEquals("9", settings.platformVersion)
        assertEquals("com.viber.voip", settings.appPackage)
        // systemPort намеренно не задан: Appium подбирает свободный порт сам.
        assertNull(settings.systemPort)
    }
}
