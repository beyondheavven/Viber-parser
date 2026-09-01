package com.viber

import com.viber.config.DatabaseSettings
import io.ktor.server.config.ApplicationConfig
import io.ktor.server.config.MapApplicationConfig
import io.ktor.server.config.yaml.YamlConfigLoader
import java.time.Duration
import kotlin.test.Test
import kotlin.test.assertEquals

class DatabaseSettingsTest {

    @Test
    fun `falls back to the stock Viber database when the section is missing`() {
        val settings = DatabaseSettings.from(MapApplicationConfig())

        assertEquals("/data/data/com.viber.voip/databases/viber_messages", settings.databasePath)
        assertEquals(Duration.ofSeconds(60), settings.queryTimeout)
    }

    @Test
    fun `reads every property from the database section`() {
        val config = MapApplicationConfig(
            "database.path" to "/data/data/com.viber.voip/databases/viber_data",
            "database.queryTimeoutSeconds" to "5",
        )

        val settings = DatabaseSettings.from(config)

        assertEquals("/data/data/com.viber.voip/databases/viber_data", settings.databasePath)
        assertEquals(Duration.ofSeconds(5), settings.queryTimeout)
    }

    @Test
    fun `a blank value does not win over the default`() {
        val config = MapApplicationConfig(
            "database.path" to "",
            "database.queryTimeoutSeconds" to "",
        )

        val settings = DatabaseSettings.from(config)

        assertEquals("/data/data/com.viber.voip/databases/viber_messages", settings.databasePath)
        assertEquals(Duration.ofSeconds(60), settings.queryTimeout)
    }

    @Test
    fun `the shipped application yaml resolves to a readable database path`() {
        val config: ApplicationConfig = YamlConfigLoader().load("application.yaml")
            ?: error("application.yaml is not on the test classpath")

        val settings = DatabaseSettings.from(config)

        assertEquals("/data/data/com.viber.voip/databases/viber_messages", settings.databasePath)
    }
}
