package com.viber

import com.viber.bot.RosterClient
import com.viber.plugins.configureException
import com.viber.routes.usersRoutes
import com.viber.services.UsersSyncService
import io.ktor.client.request.post
import io.ktor.http.HttpStatusCode
import io.ktor.serialization.kotlinx.json.json
import io.ktor.server.application.install
import io.ktor.server.plugins.contentnegotiation.ContentNegotiation
import io.ktor.server.routing.routing
import io.ktor.server.testing.testApplication
import kotlin.test.Test
import kotlin.test.assertEquals

class UsersDeviceRoutingTest {

    @Test
    fun `sync group route forwards device id to roster reads`() = testApplication {
        val roster = RecordingRoster()
        application {
            routing { usersRoutes(UsersSyncService(roster, supabase = { null }), parserSecret = null) }
        }

        client.post("/users/sync/group/13?deviceId=viber-worker-03")

        assertEquals(
            listOf("group:viber-worker-03", "participants:viber-worker-03"),
            roster.calls,
        )
    }

    @Test
    fun `sync routes reject unsafe device ids before roster reads`() = testApplication {
        val roster = RecordingRoster()
        application {
            install(ContentNegotiation) { json() }
            configureException()
            routing { usersRoutes(UsersSyncService(roster, supabase = { null }), parserSecret = null) }
        }

        val response = client.post("/users/sync/group/13?deviceId=..%2Fqueue")

        assertEquals(HttpStatusCode.BadRequest, response.status)
        assertEquals(emptyList(), roster.calls)
    }

    private class RecordingRoster : RosterClient {
        val calls = mutableListOf<String>()

        override suspend fun getGroups(includeAll: Boolean): String = error("legacy call")
        override suspend fun getGroup(id: Int): String = error("legacy call")
        override suspend fun getGroupParticipants(id: Int): String = error("legacy call")
        override suspend fun getTask(taskId: String): String = error("legacy call")
        override suspend fun getTaskParticipants(taskId: String): String = error("legacy call")

        override suspend fun getGroup(id: Int, deviceId: String?): String {
            calls += "group:$deviceId"
            return """{"id":13,"type":5,"name":"Test","messageCount":0,"participantCount":0,"unreadCount":0}"""
        }

        override suspend fun getGroupParticipants(id: Int, deviceId: String?): String {
            calls += "participants:$deviceId"
            return "[]"
        }
    }
}
