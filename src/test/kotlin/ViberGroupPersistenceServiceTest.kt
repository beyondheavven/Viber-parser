import com.viber.models.ViberGroupRow
import com.viber.services.ViberGroupPersistenceService
import com.viber.services.ViberGroupRepository
import kotlinx.coroutines.runBlocking
import kotlin.test.Test
import kotlin.test.assertEquals

class ViberGroupPersistenceServiceTest {

    @Test
    fun `roster sync promotes the instance placeholder instead of creating a second group`() = runBlocking {
        val repository = FakeGroupRepository()
        val service = ViberGroupPersistenceService(repository) { "2026-09-27T17:00:00Z" }

        val placeholder = service.resolveForMessage("emulator-a", 26, "Temporary")
        val promoted = service.promoteFromRoster(
            instanceId = "emulator-a",
            conversationId = 26,
            viberGroupId = "987654321",
            name = "Real group",
            participantCount = 42,
        )
        val resolvedAgain = service.resolveForMessage("emulator-a", 26, "Temporary")

        assertEquals(77L, placeholder.id)
        assertEquals(77L, promoted.id)
        assertEquals(77L, resolvedAgain.id)
        assertEquals("987654321", promoted.groupKey)
        assertEquals("Real group", promoted.name)
        assertEquals(42, promoted.participantCount)
        assertEquals(1, repository.rows.size)
    }
}

private class FakeGroupRepository : ViberGroupRepository {
    val rows = mutableMapOf<Pair<String, Int>, ViberGroupRow>()

    override suspend fun find(instanceId: String, conversationId: Int): ViberGroupRow? =
        rows[instanceId to conversationId]

    override suspend fun insertPlaceholderIfAbsent(group: ViberGroupRow): ViberGroupRow {
        val key = group.instanceId to requireNotNull(group.conversationId)
        return rows.getOrPut(key) { group.copy(id = 77) }
    }

    override suspend fun upsertRosterGroup(group: ViberGroupRow): ViberGroupRow {
        val key = group.instanceId to requireNotNull(group.conversationId)
        val promoted = group.copy(id = rows[key]?.id ?: 77)
        rows[key] = promoted
        return promoted
    }
}
