package com.viber

import com.viber.config.util.ConfigUtil
import io.ktor.server.config.ApplicationConfig
import io.ktor.server.config.MapApplicationConfig
import io.ktor.server.config.yaml.YamlConfigLoader
import java.time.Duration
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import kotlin.test.assertTrue

class ConfigUtilTest {

    @Test
    fun `text reads a dotted key from the section`() {
        val config = MapApplicationConfig("appium.serverUrl" to "http://127.0.0.1:4723")

        assertEquals("http://127.0.0.1:4723", ConfigUtil(config, "appium").text("serverUrl"))
    }

    @Test
    fun `text returns null for a missing key`() {
        val util = ConfigUtil(MapApplicationConfig(), "appium")

        assertNull(util.text("serverUrl"))
    }

    @Test
    fun `text returns null for a blank value`() {
        val config = MapApplicationConfig("appium.serverUrl" to "   ")

        assertNull(ConfigUtil(config, "appium").text("serverUrl"))
    }

    @Test
    fun `requireText fails loudly naming the dotted key`() {
        val util = ConfigUtil(MapApplicationConfig(), "appium")

        val error = assertFailsWith<IllegalArgumentException> { util.requireText("serverUrl") }

        assertTrue(error.message!!.contains("appium.serverUrl"), error.message!!)
    }

    @Test
    fun `seconds int and bool parse their values`() {
        val config = MapApplicationConfig(
            "database.queryTimeoutSeconds" to "5",
            "appium.systemPort" to "8201",
            "appium.autoConnectAdb" to "false",
        )

        assertEquals(Duration.ofSeconds(5), ConfigUtil(config, "database").seconds("queryTimeoutSeconds"))
        assertEquals(8201, ConfigUtil(config, "appium").int("systemPort"))
        assertEquals(false, ConfigUtil(config, "appium").bool("autoConnectAdb"))

        val badConfig = MapApplicationConfig(
            "appium.systemPort" to "not-a-number",
            "appium.autoConnectAdb" to "not-a-bool",
        )

        assertNull(ConfigUtil(badConfig, "appium").int("systemPort"))
        assertNull(ConfigUtil(badConfig, "appium").bool("autoConnectAdb"))
    }

    @Test
    fun `the shipped application yaml resolves appium serverUrl`() {
        val config: ApplicationConfig = YamlConfigLoader().load("application.yaml")
            ?: error("application.yaml is not on the test classpath")

        // Ломается, если env APPIUM_* заданы в окружении прогона — это ожидаемо.
        assertEquals("http://127.0.0.1:4773", ConfigUtil(config, "appium").requireText("serverUrl"))
    }
}
