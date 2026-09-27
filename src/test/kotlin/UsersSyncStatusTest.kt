package com.viber

import com.viber.bot.RosterClient
import com.viber.services.UsersSyncService
import kotlinx.coroutines.runBlocking
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class UsersSyncStatusTest {

    private object NoRoster : RosterClient {
        override suspend fun getGroups(includeAll: Boolean): String = error("not used")
        override suspend fun getGroup(id: Int): String = error("not used")
        override suspend fun getGroupParticipants(id: Int): String = error("not used")
        override suspend fun getTask(taskId: String): String = error("not used")
        override suspend fun getTaskParticipants(taskId: String): String = error("not used")
    }

    @Test
    fun `reports an unconfigured database instead of throwing`() = runBlocking {
        val status = UsersSyncService(NoRoster, supabase = { null }).syncStatus()

        assertFalse(status.configured)
        assertFalse(status.reachable)
        assertTrue(status.message.contains("SUPABASE_URL"), status.message)
        assertNull(status.usersTotal)
        assertEquals(emptyList(), status.groups)
    }
}
