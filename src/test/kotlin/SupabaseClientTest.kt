package com.viber

import com.viber.supabase.supabaseClient
import io.ktor.server.testing.testApplication
import kotlin.test.Test
import kotlin.test.assertNotNull
import kotlin.test.assertNull

class SupabaseClientTest {

    @Test
    fun `leaves the client unset when supabase is not configured`() {
        testApplication {
            configure()

            startApplication()

            assertNull(supabaseClient)
        }

        assertNull(supabaseClient)
    }

    @Test
    fun `creates the client when url and key are configured`() {
        testApplication {
            configure(overrides = {
                put("supabase.url", "https://project.supabase.co")
                put("supabase.key", "test-key")
            })

            startApplication()

            assertNotNull(supabaseClient)
        }

        assertNull(supabaseClient)
    }
}
