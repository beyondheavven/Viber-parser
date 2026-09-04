package com.viber

import com.viber.supabase.supabaseClient
import io.ktor.server.testing.testApplication
import kotlin.test.Test
import kotlin.test.assertNotNull
import kotlin.test.assertNull

class SupabaseClientTest {

    @Test
    fun `leaves the client unset when supabase is not configured`() {
        // Ломается, если env SUPABASE_* заданы в окружении прогона — это ожидаемо.
        testApplication {
            // Поднимает приложение так же, как EngineMain: модули берутся из application.yaml,
            // а в нём supabase.url и supabase.key по умолчанию пустые.
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

        // Приложение остановлено к этому моменту — ApplicationStopping уже отработал
        // и обнулил клиент.
        assertNull(supabaseClient)
    }
}
