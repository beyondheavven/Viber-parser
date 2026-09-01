package com.viber

import com.viber.device.Row
import com.viber.device.SqlExecutor
import com.viber.device.SqliteCsv
import com.viber.device.ViberDatabase
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

class MemberRoutesTest {

    private val groupCsv =
        "_id,group_id,name,conversation_type,members\r\n20,1234567890,\"Моя группа\",5,2\r\n"

    private val memberHeader =
        "participant_id,info_id,member_id,encrypted_member_id,number,display_name,contact_name,viber_name,alias_name,active,group_role\r\n"

    private val activeMember = "77,12,MID123,em:AQA2/Zs,+380671234567,\"Ievgen Bodnar\",\"Ievgen\",\"Bodnar\",\"Женя\",1,3\r\n"

    private val leaver = "78,13,MID999,em:AQA9zzz,+380670000000,\"Someone Else\",,,,0,3\r\n"

    /** Отвечает по смыслу запроса: карточка группы или список участников. */
    private inner class FakeDevice(private val knownGroup: String = groupCsv) : SqlExecutor {
        var lastMembersSql: String? = null
        override fun query(sql: String): List<Row> = when {
            sql.contains("from conversations c") -> SqliteCsv.parse(knownGroup)
            else -> {
                lastMembersSql = sql
                val rows = if (sql.contains("p.active = 1")) activeMember else activeMember + leaver
                SqliteCsv.parse(memberHeader + rows)
            }
        }
    }

    private fun ApplicationTestBuilder.serve(executor: SqlExecutor) {
        application {
            configureSerialization()
            routing { route("/api") { groupRoutes { ViberDatabase(executor) } } }
        }
    }

    @Test
    fun `returns the members of a group with the names Viber shows`() = testApplication {
        serve(FakeDevice())

        val response = client.get("/api/groups/20/members")

        assertEquals(HttpStatusCode.OK, response.status)
        val body = response.bodyAsText()
        assertTrue(body.contains("\"conversationId\":20"), body)
        assertTrue(body.contains("\"groupName\":\"Моя группа\""), body)
        assertTrue(body.contains("\"count\":1"), body)
        assertTrue(body.contains("\"memberId\":\"MID123\""), body)
        assertTrue(body.contains("\"number\":\"+380671234567\""), body)
        // Имя внутри группы важнее карточки контакта — его и видно в списке участников.
        assertTrue(body.contains("\"displayedName\":\"Женя\""), body)
        assertTrue(body.contains("\"groupRole\":3"), body)
        assertTrue(body.contains("\"active\":true"), body)
    }

    @Test
    fun `leaves out people who left unless they are asked for`() = testApplication {
        val device = FakeDevice()
        serve(device)

        assertTrue(client.get("/api/groups/20/members").bodyAsText().contains("\"count\":1"))
        assertTrue(device.lastMembersSql!!.contains("p.active = 1"))

        val withLeavers = client.get("/api/groups/20/members?includeInactive=true")

        val body = withLeavers.bodyAsText()
        assertTrue(body.contains("\"count\":2"), body)
        assertTrue(body.contains("MID999"), body)
        assertTrue(!device.lastMembersSql!!.contains("p.active = 1"), device.lastMembersSql!!)
    }

    @Test
    fun `answers 404 for a group that is not on the device`() = testApplication {
        serve(FakeDevice(knownGroup = ""))

        val response = client.get("/api/groups/4242/members")

        assertEquals(HttpStatusCode.NotFound, response.status)
        assertTrue(response.bodyAsText().contains("4242"), response.bodyAsText())
    }

    @Test
    fun `answers 400 when the id is not a number`() = testApplication {
        serve(FakeDevice())

        val response = client.get("/api/groups/abc/members")

        assertEquals(HttpStatusCode.BadRequest, response.status)
    }

    @Test
    fun `reports a device failure instead of an empty member list`() = testApplication {
        serve { _ -> error("sqlite3 failed (exit 1): /system/bin/sh: su: not found") }

        val response = client.get("/api/groups/20/members")

        assertEquals(HttpStatusCode.ServiceUnavailable, response.status)
        assertTrue(response.bodyAsText().contains("su: not found"), response.bodyAsText())
    }
}
