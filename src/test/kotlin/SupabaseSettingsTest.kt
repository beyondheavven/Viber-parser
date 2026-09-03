package com.viber

import com.viber.config.SupabaseSettings
import io.ktor.server.config.ApplicationConfig
import io.ktor.server.config.MapApplicationConfig
import io.ktor.server.config.yaml.YamlConfigLoader
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class SupabaseSettingsTest {

    @Test
    fun `reads url and key from the supabase section`() {
        val config = MapApplicationConfig(
            "supabase.url" to "https://project.supabase.co",
            "supabase.key" to "service-role-key",
        )

        val settings = assertNotNull(SupabaseSettings.from(config))

        assertEquals("https://project.supabase.co", settings.url)
        assertEquals("service-role-key", settings.key)
    }

    @Test
    fun `is disabled when both values are missing`() {
        assertNull(SupabaseSettings.from(MapApplicationConfig()))
    }

    @Test
    fun `is disabled when both values are blank`() {
        val config = MapApplicationConfig(
            "supabase.url" to "",
            "supabase.key" to "  ",
        )

        assertNull(SupabaseSettings.from(config))
    }

    @Test
    fun `fails loudly when only the url is set`() {
        val config = MapApplicationConfig(
            "supabase.url" to "https://project.supabase.co",
            "supabase.key" to "",
        )

        val error = assertFailsWith<IllegalArgumentException> { SupabaseSettings.from(config) }

        assertTrue(error.message!!.contains("supabase.key"), error.message!!)
        assertTrue(error.message!!.contains("set together"), error.message!!)
    }

    @Test
    fun `fails loudly when only the key is set`() {
        val config = MapApplicationConfig("supabase.key" to "service-role-key")

        val error = assertFailsWith<IllegalArgumentException> { SupabaseSettings.from(config) }

        assertTrue(error.message!!.contains("supabase.url"), error.message!!)
        assertTrue(error.message!!.contains("set together"), error.message!!)
    }

    @Test
    fun `describe never prints the key`() {
        val settings = SupabaseSettings("https://project.supabase.co", "service-role-key")

        val description = settings.describe()

        assertTrue(description.contains("https://project.supabase.co"), description)
        assertFalse(description.contains("service-role-key"), description)
    }

    @Test
    fun `toString never prints the key`() {
        val settings = SupabaseSettings("https://project.supabase.co", "service-role-key")

        val text = "$settings"

        assertTrue(text.contains("https://project.supabase.co"), text)
        assertFalse(text.contains("service-role-key"), text)
    }

    @Test
    fun `the shipped application yaml disables supabase when no env overrides are set`() {
        val config: ApplicationConfig = YamlConfigLoader().load("application.yaml")
            ?: error("application.yaml is not on the test classpath")

        // Ломается, если env SUPABASE_* заданы в окружении прогона — это ожидаемо.
        assertNull(SupabaseSettings.from(config))
    }
}
