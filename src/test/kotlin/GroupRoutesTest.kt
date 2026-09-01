package com.viber

import com.viber.db.Row
import com.viber.db.SqlExecutor
import com.viber.db.SqliteCsv
import com.viber.db.ViberDatabase
import com.viber.plugins.configureSerialization
import com.viber.plugins.groupRoutes
import io.ktor.client.request.get
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpStatusCode
import io.ktor.server.routing.route
import io.ktor.server.routing.routing
import io.ktor.server.testing.ApplicationTestBuilder
import io.ktor.server.testing.testApplication
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class GroupRoutesTest {

    private fun ApplicationTestBuilder.serve(executor: SqlExecutor) {
        application {
            configureSerialization()
            routing { route("/api") { groupRoutes { ViberDatabase(executor) } } }
        }
    }

    @Test
    fun `lists the groups found in the device database`() = testApplication {
        serve { _ ->
            SqliteCsv.parse(
                "_id,group_id,name,conversation_type,members\r\n" +
                    "20,1234567890,\"Моя группа\",5,53\r\n" +
                    "1,987,,5,2\r\n"
            )
        }

        val response = client.get("/api/groups")

        assertEquals(HttpStatusCode.OK, response.status)
        val body = response.bodyAsText()
        assertTrue(body.contains("\"conversationId\":20"), body)
        assertTrue(body.contains("Моя группа"), body)
        assertTrue(body.contains("\"memberCount\":53"), body)
        assertTrue(body.contains("\"groupId\":1234567890"), body)
        assertTrue(body.contains("\"count\":2"), body)
    }

    @Test
    fun `answers with an empty list when the device has no groups`() = testApplication {
        serve { _ -> emptyList<Row>() }

        val response = client.get("/api/groups")

        assertEquals(HttpStatusCode.OK, response.status)
        assertTrue(response.bodyAsText().contains("\"groups\":[]"), response.bodyAsText())
    }

    @Test
    fun `reports the device problem instead of pretending there are no groups`() = testApplication {
        serve { _ -> error("sqlite3 failed (exit 1): /system/bin/sh: su: not found") }

        val response = client.get("/api/groups")

        assertEquals(HttpStatusCode.ServiceUnavailable, response.status)
        assertTrue(response.bodyAsText().contains("su: not found"), response.bodyAsText())
    }
}
