package com.viber

import com.viber.config.DatabaseSettings
import io.ktor.server.config.ApplicationConfig
import io.ktor.server.config.MapApplicationConfig
import io.ktor.server.config.yaml.YamlConfigLoader
import java.time.Duration
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class DatabaseSettingsTest {

    @Test
    fun `falls back to the stock Viber database when the section is missing`() {
        val settings = DatabaseSettings.from(MapApplicationConfig())

        assertEquals("/data/data/com.viber.voip/databases/viber_messages", settings.databasePath)
        assertEquals(Duration.ofSeconds(60), settings.queryTimeout)
        assertEquals(Duration.ofSeconds(120), settings.writeTimeout)
        assertTrue(settings.backupOnWrite)
    }

    @Test
    fun `reads every property from the database section`() {
        val config = MapApplicationConfig(
            "database.path" to "/data/data/com.viber.voip/databases/viber_data",
            "database.queryTimeoutSeconds" to "5",
            "database.writeTimeoutSeconds" to "7",
            "database.backupOnWrite" to "false",
        )

        val settings = DatabaseSettings.from(config)

        assertEquals("/data/data/com.viber.voip/databases/viber_data", settings.databasePath)
        assertEquals(Duration.ofSeconds(5), settings.queryTimeout)
        assertEquals(Duration.ofSeconds(7), settings.writeTimeout)
        assertFalse(settings.backupOnWrite)
    }

    @Test
    fun `keeps the backup when the flag is anything but a plain false`() {
        // Пустая или мусорная переменная окружения не должна отменить копию базы.
        listOf("", "no", "0", "FALSE").forEach { value ->
            val settings = DatabaseSettings.from(MapApplicationConfig("database.backupOnWrite" to value))

            assertTrue(settings.backupOnWrite, "backupOnWrite must survive '" + value + "'")
        }
    }

    @Test
    fun `a blank value does not win over the default`() {
        val config = MapApplicationConfig(
            "database.path" to "",
            "database.queryTimeoutSeconds" to "",
            "database.writeTimeoutSeconds" to "",
        )

        val settings = DatabaseSettings.from(config)

        assertEquals("/data/data/com.viber.voip/databases/viber_messages", settings.databasePath)
        assertEquals(Duration.ofSeconds(60), settings.queryTimeout)
        assertEquals(Duration.ofSeconds(120), settings.writeTimeout)
    }

    @Test
    fun `the shipped application yaml resolves to a readable database path`() {
        val config: ApplicationConfig = YamlConfigLoader().load("application.yaml")
            ?: error("application.yaml is not on the test classpath")

        val settings = DatabaseSettings.from(config)

        assertEquals("/data/data/com.viber.voip/databases/viber_messages", settings.databasePath)
        assertEquals(Duration.ofSeconds(120), settings.writeTimeout)
        assertTrue(settings.backupOnWrite)
    }
}
