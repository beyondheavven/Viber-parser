package com.viber.services

import com.viber.models.MonitoredMessageResponse
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonPrimitive
import java.time.Instant
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class MonitoredMessageQueryServiceTest {

    private val sampleMessages = listOf(
        MonitoredMessageResponse(
            id = 101,
            deviceId = "emulator-a",
            conversationId = 26,
            conversationName = "Group Alpha",
            token = "token-1",
            date = "2026-09-27T18:00:00Z",
            body = "Привет, мой номер +380981234567",
            senderName = "Иван",
            attachedPhone = "+380981234567",
            phoneSource = "message_text",
            hasPhoneInText = true,
        ),
        MonitoredMessageResponse(
            id = 102,
            deviceId = "emulator-a",
            conversationId = 26,
            conversationName = "Group Alpha",
            token = "token-2",
            date = "2026-09-27T18:01:00Z",
            body = "Просто сообщение без телефона, с \"кавычками\"",
            senderName = "Петр",
            attachedPhone = null,
            phoneSource = "none",
            hasPhoneInText = false,
        ),
    )

    @Test
    fun `listMessages queries repository with appropriate filters`() = runBlocking {
        val fakeRepo = FakeMonitoredMessageQueryRepository(sampleMessages)
        val service = MonitoredMessageQueryService(repository = fakeRepo)

        val messages = service.listMessages(
            deviceId = "emulator-a",
            conversationId = 26,
            hasPhone = true,
            limit = 50,
        )

        assertEquals("emulator-a", fakeRepo.lastDeviceId)
        assertEquals(26, fakeRepo.lastConversationId)
        assertEquals(true, fakeRepo.lastHasPhone)
        assertEquals(50, fakeRepo.lastLimit)
        assertEquals(2, messages.size)
    }

    @Test
    fun `exportMessages generates CSV with BOM and escaped quotes`() = runBlocking {
        val fakeRepo = FakeMonitoredMessageQueryRepository(sampleMessages)
        val service = MonitoredMessageQueryService(
            repository = fakeRepo,
            now = { Instant.parse("2026-09-27T19:00:00Z") },
        )

        val result = service.exportMessages(format = "csv", deviceId = "emulator-a")

        assertEquals("text/csv; charset=utf-8", result.contentType)
        assertTrue(result.filename.startsWith("monitored-messages-2026-09-27T19-00-00Z.csv"))
        assertTrue(result.content.startsWith("\uFEFFid,date,conversationId"))
        assertTrue(result.content.contains("\"Просто сообщение без телефона, с \"\"кавычками\"\"\""))
    }

    @Test
    fun `exportMessages generates valid JSONL`() = runBlocking {
        val fakeRepo = FakeMonitoredMessageQueryRepository(sampleMessages)
        val service = MonitoredMessageQueryService(
            repository = fakeRepo,
            now = { Instant.parse("2026-09-27T19:00:00Z") },
        )

        val result = service.exportMessages(format = "jsonl", deviceId = "emulator-a")

        assertEquals("application/x-ndjson; charset=utf-8", result.contentType)
        val lines = result.content.trim().split("\n")
        assertEquals(2, lines.size)
        val json = Json { ignoreUnknownKeys = true }
        val obj1 = json.parseToJsonElement(lines[0]).jsonObject
        assertEquals(101L, obj1["id"]?.jsonPrimitive?.content?.toLong())
    }

    @Test
    fun `exportMessages generates valid JSON envelope`() = runBlocking {
        val fakeRepo = FakeMonitoredMessageQueryRepository(sampleMessages)
        val service = MonitoredMessageQueryService(
            repository = fakeRepo,
            now = { Instant.parse("2026-09-27T19:00:00Z") },
        )

        val result = service.exportMessages(format = "json", deviceId = "emulator-a")

        assertEquals("application/json; charset=utf-8", result.contentType)
        val json = Json { ignoreUnknownKeys = true }
        val root = json.parseToJsonElement(result.content).jsonObject
        assertEquals(2, root["count"]?.jsonPrimitive?.content?.toInt())
        assertEquals(2, root["messages"]?.jsonArray?.size)
    }

    @Test
    fun `returns empty list when supabase client is null`() = runBlocking {
        val service = MonitoredMessageQueryService(supabase = { null })
        val messages = service.listMessages()
        assertTrue(messages.isEmpty())
    }
}

private class FakeMonitoredMessageQueryRepository(
    private val messages: List<MonitoredMessageResponse>,
) : MonitoredMessageQueryRepository {
    var lastDeviceId: String? = null
    var lastConversationId: Int? = null
    var lastHasPhone: Boolean? = null
    var lastPhoneSource: String? = null
    var lastLimit: Int = 0
    var lastOffset: Int = 0

    override suspend fun listMessages(
        deviceId: String?,
        conversationId: Int?,
        hasPhone: Boolean?,
        phoneSource: String?,
        limit: Int,
        offset: Int,
    ): List<MonitoredMessageResponse> {
        lastDeviceId = deviceId
        lastConversationId = conversationId
        lastHasPhone = hasPhone
        lastPhoneSource = phoneSource
        lastLimit = limit
        lastOffset = offset
        return messages
    }
}
