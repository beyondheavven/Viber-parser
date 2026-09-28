package com.viber

import com.viber.bot.RosterClient
import com.viber.models.ViberGroupRow
import com.viber.routes.usersRoutes
import com.viber.services.UsersSyncService
import io.ktor.client.request.delete
import io.ktor.client.request.header
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpStatusCode
import io.ktor.serialization.kotlinx.json.json
import io.ktor.server.application.install
import io.ktor.server.plugins.contentnegotiation.ContentNegotiation
import io.ktor.server.routing.routing
import io.ktor.server.testing.testApplication
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class UsersGroupDeleteTest {

    private val largeGroupId = 9_007_199_254_740_993L

    private object NoRoster : RosterClient {
        override suspend fun getGroups(includeAll: Boolean): String = error("not used")
        override suspend fun getGroup(id: Int): String = error("not used")
        override suspend fun getGroupParticipants(id: Int): String = error("not used")
        override suspend fun getTask(taskId: String): String = error("not used")
        override suspend fun getTaskParticipants(taskId: String): String = error("not used")
    }

    @Test
    fun `deletes a group by database id and returns its identity`() = testApplication {
        var deletedId: Long? = null
        val service = UsersSyncService(
            NoRoster,
            supabase = { null },
            deleteGroupById = { id ->
                deletedId = id
                ViberGroupRow(
                    id = id,
                    instanceId = "worker-02",
                    groupKey = "group-key",
                    conversationId = 3,
                    name = "Тестовая группа",
                    participantCount = 10,
                )
            },
        )
        application {
            install(ContentNegotiation) { json() }
            routing { usersRoutes(service, parserSecret = "test-parser-secret") }
        }

        val response = client.delete("/users/groups/$largeGroupId") {
            header("x-parser-secret", "test-parser-secret")
        }

        assertEquals(HttpStatusCode.OK, response.status)
        assertEquals(largeGroupId, deletedId)
        val body = response.bodyAsText()
        assertTrue(body.contains("\"id\":\"$largeGroupId\""), body)
        assertTrue(body.contains("Тестовая группа"), body)
        assertTrue(body.contains("worker-02"), body)
    }

    @Test
    fun `returns not found when database group id does not exist`() = testApplication {
        val service = UsersSyncService(
            NoRoster,
            supabase = { null },
            deleteGroupById = { null },
        )
        application {
            install(ContentNegotiation) { json() }
            routing { usersRoutes(service, parserSecret = "test-parser-secret") }
        }

        val response = client.delete("/users/groups/404") {
            header("x-parser-secret", "test-parser-secret")
        }
        assertEquals(HttpStatusCode.NotFound, response.status)
    }

    @Test
    fun `rejects a missing or invalid parser secret without deleting`() = testApplication {
        var deleteCalls = 0
        val service = UsersSyncService(
            NoRoster,
            supabase = { null },
            deleteGroupById = {
                deleteCalls += 1
                null
            },
        )
        application {
            install(ContentNegotiation) { json() }
            routing { usersRoutes(service, parserSecret = "test-parser-secret") }
        }

        assertEquals(HttpStatusCode.Unauthorized, client.delete("/users/groups/91").status)
        val invalid = client.delete("/users/groups/91") {
            header("x-parser-secret", "wrong-secret")
        }
        assertEquals(HttpStatusCode.Unauthorized, invalid.status)
        assertEquals(0, deleteCalls)
    }

    @Test
    fun `fails closed when parser secret is not configured`() = testApplication {
        var deleteCalls = 0
        val service = UsersSyncService(
            NoRoster,
            supabase = { null },
            deleteGroupById = {
                deleteCalls += 1
                null
            },
        )
        application {
            install(ContentNegotiation) { json() }
            routing { usersRoutes(service, parserSecret = null) }
        }

        val response = client.delete("/users/groups/91") {
            header("x-parser-secret", "anything")
        }
        assertEquals(HttpStatusCode.Unauthorized, response.status)
        assertEquals(0, deleteCalls)
    }
}
