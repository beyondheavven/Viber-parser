package com.viber

import com.viber.bot.RosterClient
import com.viber.models.ViberGroupMemberRow
import com.viber.models.ViberUserRow
import com.viber.services.UsersSyncService
import io.github.jan.supabase.createSupabaseClient
import io.github.jan.supabase.postgrest.Postgrest
import io.github.jan.supabase.postgrest.from
import kotlinx.coroutines.runBlocking
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * Round-trips a fake roster through the real Supabase project.
 *
 * Runs only when SUPABASE_URL and SUPABASE_SERVICE_KEY are set in the
 * environment, so the ordinary `gradlew test` stays offline:
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_KEY=... ./gradlew test --tests com.viber.UsersSyncIntegrationTest
 *
 * Every row it writes carries the `it-` prefix and is deleted at the end.
 */
class UsersSyncIntegrationTest {

    private val url = System.getenv("SUPABASE_URL")?.takeIf { it.isNotBlank() }
    private val key = System.getenv("SUPABASE_SERVICE_KEY")?.takeIf { it.isNotBlank() }

    /** Conversation id no real device will ever produce. */
    private val conversationId = -424242

    private fun participantJson(
        memberId: String?,
        number: String?,
        name: String,
        role: Int = 3,
        isSelf: Boolean = false,
        isOnline: Boolean? = null,
    ): String = buildString {
        append("{\"id\":1,")
        append("\"memberId\":${memberId?.let { "\"$it\"" } ?: "null"},")
        append("\"number\":${number?.let { "\"$it\"" } ?: "null"},")
        append("\"name\":\"$name\",\"contactName\":null,\"viberName\":\"$name\",")
        append("\"groupRole\":$role,\"roleLabel\":\"member\",\"active\":true,")
        append("\"isSelf\":$isSelf,\"isOnline\":${isOnline ?: "null"},\"lastSeen\":null}")
    }

    private class FakeRoster(private val group: String, private val participants: String) : RosterClient {
        override suspend fun getGroups(includeAll: Boolean): String = "[$group]"
        override suspend fun getGroup(id: Int): String = group
        override suspend fun getGroupParticipants(id: Int): String = participants
        override suspend fun getTask(taskId: String): String = error("not used")
        override suspend fun getTaskParticipants(taskId: String): String = error("not used")
    }

    private val groupJson =
        "{\"id\":$conversationId,\"type\":5,\"groupId\":null,\"name\":\"it-group\"," +
            "\"messageCount\":0,\"participantCount\":3,\"unreadCount\":0}"

    @Test
    fun `syncs a roster twice and deactivates the member that left`() {
        val url = url ?: return
        val key = key ?: return
        val client = createSupabaseClient(url, key) { install(Postgrest) }

        val first = "[" + listOf(
            participantJson("it-member-a", "+375 29 111-11-11", "Alice", role = 1, isOnline = true),
            participantJson("em:encrypted", "+375291112222", "Bob"),
            participantJson("it-member-self", "+375291113333", "Me", isSelf = true),
            participantJson("em:encrypted", "Ожидает дешифровки", "Nobody"),
        ).joinToString(",") + "]"
        val second = "[" + participantJson("it-member-a", "+375291111111", "Alice", role = 1) + "]"

        runBlocking {
            try {
                val service1 = UsersSyncService(FakeRoster(groupJson, first), supabase = { client })
                val result1 = service1.syncGroup(conversationId)
                assertEquals(4, result1.received)
                assertEquals(2, result1.usersUpserted)
                assertEquals(2, result1.skipped)
                assertEquals(0, result1.deactivated)

                val alice = client.from("viber_users").select {
                    filter { eq("identity_key", "it-member-a") }
                }.decodeSingle<ViberUserRow>()
                assertEquals("+375291111111", alice.phone)
                assertEquals(true, alice.isOnline)

                val bob = client.from("viber_users").select {
                    filter { eq("identity_key", "phone:375291112222") }
                }.decodeSingle<ViberUserRow>()
                assertEquals(null, bob.memberId)

                val page = service1.listUsers(limit = 10, offset = 0, phone = "37529111", name = null)
                assertTrue(page.items.any { it.identityKey == "it-member-a" }, page.toString())

                val service2 = UsersSyncService(FakeRoster(groupJson, second), supabase = { client })
                val result2 = service2.syncGroup(conversationId)
                assertEquals(1, result2.usersUpserted)
                assertEquals(1, result2.deactivated)

                val members = client.from("viber_group_members").select {
                    filter { eq("user_id", bob.id!!) }
                }.decodeList<ViberGroupMemberRow>()
                assertEquals(listOf(false), members.map { it.active })

                // The status endpoint must see exactly what the two syncs wrote.
                val status = service2.syncStatus(conversationId)
                assertTrue(status.configured && status.reachable, status.message)
                val group = status.groups.single()
                assertTrue(group.id.toLong() > 0)
                assertEquals(conversationId, group.conversationId)
                assertEquals(1, group.participantCount)
                assertEquals(1, group.activeMembers)
                assertEquals(1, group.inactiveMembers)
                // Postgres keeps microseconds; Instant.now() can carry nanoseconds.
                val micros = java.time.temporal.ChronoUnit.MICROS
                assertEquals(
                    java.time.Instant.parse(result2.syncedAt).truncatedTo(micros),
                    group.lastSyncedAt?.let { java.time.Instant.parse(it).truncatedTo(micros) },
                )
                assertTrue((status.usersTotal ?: 0) >= 2, status.toString())

                val missing = service2.syncStatus(conversationId - 1)
                assertEquals(emptyList(), missing.groups)
                assertTrue(missing.message.contains("ещё не записывалась"), missing.message)

                val deleted = assertNotNull(service2.deleteGroup(group.id.toLong()))
                assertEquals(group.id, deleted.id)
                val remainingUsers = client.from("viber_users").select {
                    filter {
                        or {
                            eq("identity_key", "it-member-a")
                            eq("identity_key", "phone:375291112222")
                        }
                    }
                }.decodeList<ViberUserRow>()
                assertEquals(2, remainingUsers.size)
                assertEquals(emptyList(), service2.syncStatus(conversationId).groups)
            } finally {
                client.from("viber_groups").delete { filter { eq("group_key", "conv:$conversationId") } }
                client.from("viber_users").delete {
                    filter { or { eq("identity_key", "it-member-a"); eq("identity_key", "phone:375291112222") } }
                }
                client.close()
            }
        }
    }
}
