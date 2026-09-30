package com.viber

import com.viber.bot.RosterClient
import com.viber.models.ViberGroupRow
import com.viber.services.UsersSyncService
import kotlinx.coroutines.runBlocking
import kotlin.test.Test
import kotlin.test.assertEquals

class UsersGroupLookupTest {

    private object NoRoster : RosterClient {
        override suspend fun getGroups(includeAll: Boolean): String = error("not used")
        override suspend fun getGroup(id: Int): String = error("not used")
        override suspend fun getGroupParticipants(id: Int): String = error("not used")
        override suspend fun getTask(taskId: String): String = error("not used")
        override suspend fun getTaskParticipants(taskId: String): String = error("not used")
    }

    private val rows = listOf(
        ViberGroupRow(
            id = 3,
            instanceId = "test-emulator",
            groupKey = "5569560781658637023",
            viberGroupId = "5569560781658637023",
            conversationId = 3,
            name = "УКРАЇНЦІ В БЕРЛІНІ",
            participantCount = 3295,
            lastSyncedAt = "2026-09-30T13:53:00Z",
        ),
        ViberGroupRow(
            id = 5,
            instanceId = "viber-worker-03",
            groupKey = "5937770265754866656",
            viberGroupId = "5937770265754866656",
            conversationId = 3,
            name = "ОПІКУНОЧКА",
            participantCount = 0,
            lastSyncedAt = "2026-09-30T02:12:00Z",
        ),
    )

    @Test
    fun `conversation id lookup does not pick a group of another instance`() = runBlocking {
        val service = UsersSyncService(
            NoRoster,
            supabase = { null },
            findGroup = { column, value, instanceId ->
                rows.filter { row ->
                    val cell = when (column) {
                        "group_key" -> row.groupKey
                        "viber_group_id" -> row.viberGroupId
                        "conversation_id" -> row.conversationId
                        else -> error("unexpected column $column")
                    }
                    cell == value && (instanceId == null || row.instanceId == instanceId)
                }.maxByOrNull { it.lastSyncedAt.orEmpty() }
            },
        )

        assertEquals(3L, service.resolveGroup("3", "test-emulator")?.id)
        assertEquals(5L, service.resolveGroup("3", "viber-worker-03")?.id)
        assertEquals(3L, service.resolveGroup("3")?.id)
        assertEquals(5L, service.resolveGroup("5937770265754866656", "test-emulator")?.id)
    }
}
