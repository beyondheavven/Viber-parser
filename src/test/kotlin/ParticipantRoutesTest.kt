package com.viber

import com.viber.appium.ParserState
import com.viber.device.participants.ParticipantDecoder
import com.viber.device.sqlite.Row
import com.viber.device.SqlExecutor
import com.viber.device.SqlWriter
import com.viber.device.sqlite.SqliteCsv
import com.viber.device.WriteResult
import com.viber.plugins.configureSerialization
import com.viber.routes.participantRoutes
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.server.routing.route
import io.ktor.server.routing.routing
import io.ktor.server.testing.ApplicationTestBuilder
import io.ktor.server.testing.testApplication
import java.util.Base64
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class ParticipantRoutesTest {

    private class FakeWriter : SqlWriter {
        var statements: List<String>? = null
        override fun execute(statements: List<String>, restartApp: Boolean): WriteResult {
            this.statements = statements
            return WriteResult(changedRows = statements.size, backupPath = "/data/viber_messages.bak")
        }
    }

    private fun envelope(key: Int): String = Base64.getEncoder().encodeToString(
        byteArrayOf(0x01, 0x00) + ByteArray(8) { key.toByte() } + byteArrayOf(0x1a, 0x6f) + ByteArray(30)
    )

    private val header =
        "_id,member_id,encrypted_member_id,number,participant_type,contact_name,display_name,viber_name,safe_contact"

    private val oneCard = header + "\r\n7,old," + envelope(1) + ",+37529,2,,Пётр,,1\r\n"

    private fun ApplicationTestBuilder.serve(
        executor: SqlExecutor,
        writer: SqlWriter = FakeWriter(),
        state: ParserState = ParserState.IDLE,
    ) {
        application {
            configureSerialization()
            routing {
                route("/api") {
                    participantRoutes({ ParticipantDecoder(executor, writer) }, { state })
                }
            }
        }
    }

    @Test
    fun `decodes the cards and reports what it wrote`() = testApplication {
        val writer = FakeWriter()
        serve({ _ -> SqliteCsv.parse(oneCard) }, writer)

        val response = client.post("/api/participants/decode")

        assertEquals(HttpStatusCode.OK, response.status)
        val body = response.bodyAsText()
        assertTrue(body.contains("\"read\":1"), body)
        assertTrue(body.contains("\"updated\":1"), body)
        assertTrue(body.contains("\"dryRun\":false"), body)
        assertTrue(body.contains("\"newMemberId\":\"AQEBAQEBAQE=\""), body)
        // Ответ показывает записанное состояние, а прежнее — отдельными previous*-полями.
        assertTrue(body.contains("\"participantType\":1"), body)
        assertTrue(body.contains("\"safeContact\":0"), body)
        assertTrue(body.contains("\"previousParticipantType\":2"), body)
        assertTrue(body.contains("\"previousNumber\":\"+37529\""), body)
        assertTrue(body.contains("Пётр"), body)
        assertTrue(body.contains("viber_messages.bak"), body)
        assertEquals(1, writer.statements?.size)
    }

    @Test
    fun `a dry run answers with the same report but leaves the device alone`() = testApplication {
        val writer = FakeWriter()
        serve({ _ -> SqliteCsv.parse(oneCard) }, writer)

        val response = client.post("/api/participants/decode") {
            contentType(ContentType.Application.Json)
            setBody("""{"dryRun":true}""")
        }

        assertEquals(HttpStatusCode.OK, response.status)
        val body = response.bodyAsText()
        assertTrue(body.contains("\"dryRun\":true"), body)
        assertTrue(body.contains("\"decodedCount\":1"), body)
        assertTrue(body.contains("\"updated\":0"), body)
        assertNull(writer.statements)
    }

    @Test
    fun `passes the options through to the decoder`() = testApplication {
        val writer = FakeWriter()
        serve({ _ -> SqliteCsv.parse(header + "\r\n7,own," + envelope(1) + ",+37529,0,,,,0\r\n") }, writer)

        val kept = client.post("/api/participants/decode")
        assertTrue(kept.bodyAsText().contains("OWN_ACCOUNT"), kept.bodyAsText())

        val touched = client.post("/api/participants/decode") {
            contentType(ContentType.Application.Json)
            setBody("""{"includeSelf":true}""")
        }
        assertTrue(touched.bodyAsText().contains("\"decodedCount\":1"), touched.bodyAsText())
    }

    @Test
    fun `refuses a limit that cannot mean anything`() = testApplication {
        serve({ _ -> emptyList<Row>() })

        val response = client.post("/api/participants/decode") {
            contentType(ContentType.Application.Json)
            setBody("""{"limit":0}""")
        }

        assertEquals(HttpStatusCode.BadRequest, response.status)
        assertTrue(response.bodyAsText().contains("limit"), response.bodyAsText())
    }

    @Test
    fun `refuses a body it cannot read`() = testApplication {
        serve({ _ -> emptyList<Row>() })

        val response = client.post("/api/participants/decode") {
            contentType(ContentType.Application.Json)
            setBody("""{"dryRun":"нет"}""")
        }

        assertEquals(HttpStatusCode.BadRequest, response.status)
    }

    @Test
    fun `will not rewrite the database under a running Appium session`() = testApplication {
        val writer = FakeWriter()
        serve({ _ -> SqliteCsv.parse(oneCard) }, writer, state = ParserState.RUNNING)

        val response = client.post("/api/participants/decode")

        assertEquals(HttpStatusCode.Conflict, response.status)
        assertNull(writer.statements)
    }

    @Test
    fun `still answers a dry run while a session is running`() = testApplication {
        serve({ _ -> SqliteCsv.parse(oneCard) }, state = ParserState.RUNNING)

        val response = client.post("/api/participants/decode") {
            contentType(ContentType.Application.Json)
            setBody("""{"dryRun":true}""")
        }

        assertEquals(HttpStatusCode.OK, response.status)
    }

    @Test
    fun `reports an unreachable device instead of an empty result`() = testApplication {
        serve({ _ -> error("sqlite3 failed (exit 1): /system/bin/sh: su: not found") })

        val response = client.post("/api/participants/decode")

        assertEquals(HttpStatusCode.ServiceUnavailable, response.status)
        assertTrue(response.bodyAsText().contains("su: not found"), response.bodyAsText())
    }
}
