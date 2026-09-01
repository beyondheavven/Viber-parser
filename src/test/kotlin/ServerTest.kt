package com.viber

import io.ktor.client.request.get
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpStatusCode
import io.ktor.server.testing.testApplication
import kotlin.test.Test
import kotlin.test.assertEquals

class ServerTest {

    @Test
    fun `health endpoint answers on the default configuration`() = testApplication {
        // Поднимает приложение так же, как EngineMain: модули берутся из application.yaml.
        configure()

        val response = client.get("/health")

        assertEquals(HttpStatusCode.OK, response.status)
        assertEquals("Parser started", response.bodyAsText())
    }

    @Test
    fun `the app serves no root route`() = testApplication {
        configure()

        // Раньше тест ждал здесь 200 и падал: маршрута "/" в приложении нет и не было.
        assertEquals(HttpStatusCode.NotFound, client.get("/").status)
    }
}
