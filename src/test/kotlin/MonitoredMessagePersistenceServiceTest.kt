import com.viber.models.MonitoredMessageEvent
import com.viber.models.ViberGroupRow
import com.viber.models.ViberMonitoredMessageRow
import com.viber.services.MonitoredMessagePersistenceService
import com.viber.services.MonitoredMessageRepository
import kotlinx.coroutines.runBlocking
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class MonitoredMessagePersistenceServiceTest {

    @Test
    fun `creates a placeholder group before persisting the first message`() = runBlocking {
        val repository = FakeMonitoredMessageRepository()
        val service = MonitoredMessagePersistenceService(repository) { "2026-09-27T17:00:00Z" }

        service.persist(message(conversationName = "Berlin"))

        assertEquals("conv:26", repository.upsertedGroups.single().groupKey)
        assertEquals("emulator-a", repository.upsertedGroups.single().instanceId)
        assertEquals(26, repository.upsertedGroups.single().conversationId)
        assertEquals("Berlin", repository.upsertedGroups.single().name)
        assertEquals(77L, repository.upsertedMessages.single().groupId)
    }

    @Test
    fun `reuses an existing group instead of creating a competing placeholder`() = runBlocking {
        val repository = FakeMonitoredMessageRepository(
            existingGroup = ViberGroupRow(
                id = 91,
                instanceId = "emulator-a",
                groupKey = "community:stable",
                conversationId = 26,
                name = "Synced group",
                participantCount = 12,
            ),
        )
        val service = MonitoredMessagePersistenceService(repository) { "2026-09-27T17:00:00Z" }

        service.persist(message())

        assertEquals(emptyList(), repository.upsertedGroups)
        assertEquals(91L, repository.upsertedMessages.single().groupId)
    }

    @Test
    fun `late enrichment upserts the same logical message with resolved profile fields`() = runBlocking {
        val repository = FakeMonitoredMessageRepository()
        val service = MonitoredMessagePersistenceService(repository) { "2026-09-27T17:00:00Z" }

        service.persist(message())
        service.persist(
            message(
                senderName = "Иван Петров",
                attachedPhone = "+380988806081",
                phoneSource = "viber_profile",
                body = "Обновлённый текст",
            ),
        )

        val initial = repository.upsertedMessages[0]
        val enriched = repository.upsertedMessages[1]
        assertEquals(1, repository.upsertedGroups.size)
        assertEquals(initial.conversationId, enriched.conversationId)
        assertEquals(initial.sourceKey, enriched.sourceKey)
        assertNull(initial.phone)
        assertEquals("+380988806081", enriched.phone)
        assertEquals("viber_profile", enriched.phoneSource)
        assertEquals("Иван Петров", enriched.senderName)
        assertEquals("Обновлённый текст", enriched.content)
    }

    @Test
    fun `falls back to conversation row identity when Viber token is invalid`() = runBlocking {
        val repository = FakeMonitoredMessageRepository()
        val service = MonitoredMessagePersistenceService(repository) { "2026-09-27T17:00:00Z" }

        service.persist(message(token = "0", id = 501))

        assertEquals("row:501", repository.upsertedMessages.single().sourceKey)
    }

    @Test
    fun `scopes equal conversation and row identities to their emulator instance`() = runBlocking {
        val repository = FakeMonitoredMessageRepository()
        val service = MonitoredMessagePersistenceService(repository) { "2026-09-27T17:00:00Z" }

        service.persist(message(instanceId = "emulator-a", token = null, id = 501))
        service.persist(message(instanceId = "emulator-b", token = null, id = 501))

        assertEquals(listOf("emulator-a", "emulator-b"), repository.upsertedMessages.map { it.instanceId })
        assertEquals(listOf(77L, 78L), repository.upsertedMessages.map { it.groupId })
        assertEquals(listOf("row:501", "row:501"), repository.upsertedMessages.map { it.sourceKey })
    }

    private fun message(
        instanceId: String = "emulator-a",
        id: Long = 101,
        token: String? = "stable-token",
        conversationName: String? = "Group",
        senderName: String? = "Иван",
        attachedPhone: String? = null,
        phoneSource: String = "none",
        body: String? = "Привет",
    ) = MonitoredMessageEvent(
        instanceId = instanceId,
        id = id,
        conversationId = 26,
        conversationName = conversationName,
        token = token,
        date = "2026-09-05T12:00:00.000Z",
        body = body,
        senderName = senderName,
        attachedPhone = attachedPhone,
        phoneSource = phoneSource,
    )
}

private class FakeMonitoredMessageRepository(
    existingGroup: ViberGroupRow? = null,
) : MonitoredMessageRepository {
    private val groups = mutableMapOf<Pair<String, Int>, ViberGroupRow>()
    val upsertedGroups = mutableListOf<ViberGroupRow>()
    val upsertedMessages = mutableListOf<ViberMonitoredMessageRow>()

    init {
        if (existingGroup != null) groups[existingGroup.instanceId to requireNotNull(existingGroup.conversationId)] = existingGroup
    }

    override suspend fun find(instanceId: String, conversationId: Int): ViberGroupRow? =
        groups[instanceId to conversationId]

    override suspend fun insertPlaceholderIfAbsent(group: ViberGroupRow): ViberGroupRow {
        upsertedGroups += group
        val key = group.instanceId to requireNotNull(group.conversationId)
        return groups.getOrPut(key) { group.copy(id = 77L + groups.size) }
    }

    override suspend fun upsertRosterGroup(group: ViberGroupRow): ViberGroupRow = error("not used")

    override suspend fun upsertMessage(message: ViberMonitoredMessageRow) {
        upsertedMessages += message
    }
}
