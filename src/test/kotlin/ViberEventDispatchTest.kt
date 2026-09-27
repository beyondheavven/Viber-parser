import com.viber.consumers.IncomingViberEvent
import com.viber.consumers.DeliveryDisposition
import com.viber.consumers.decodeViberEvent
import com.viber.consumers.dispatchViberEvent
import com.viber.consumers.handleViberEvent
import kotlinx.coroutines.runBlocking
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNull

class ViberEventDispatchTest {

    @Test
    fun `decodes a monitored message event from the existing events queue envelope`() {
        val event = decodeViberEvent(
            """
            {
              "pattern": "viber.message.received",
              "data": {
                "id": 101,
                "instanceId": "emulator-a",
                "conversationId": 26,
                "conversationName": "Berlin",
                "token": "stable-token",
                "date": "2026-09-05T12:00:00.000Z",
                "body": "Привет",
                "senderName": "Иван",
                "attachedPhone": "+380988806081",
                "phoneSource": "viber_profile",
                "hasMedia": false
              }
            }
            """.trimIndent().encodeToByteArray(),
        )

        val message = assertIs<IncomingViberEvent.MonitoredMessage>(event).message
        assertEquals(26, message.conversationId)
        assertEquals("emulator-a", message.instanceId)
        assertEquals("stable-token", message.token)
        assertEquals("+380988806081", message.attachedPhone)
    }

    @Test
    fun `keeps ready task dispatch on the same queue`() {
        val event = decodeViberEvent(
            """{"pattern":"viber.task.event","data":{"taskId":"task-1","status":"ready","instanceId":"emulator-a"}}"""
                .encodeToByteArray(),
        )

        val ready = assertIs<IncomingViberEvent.ReadyTask>(event)
        assertEquals("task-1", ready.taskId)
        assertEquals("emulator-a", ready.instanceId)
    }

    @Test
    fun `routes task and message events to separate handlers`() = runBlocking {
        val tasks = mutableListOf<String>()
        val messages = mutableListOf<Long>()

        dispatchViberEvent(
            IncomingViberEvent.ReadyTask("task-1"),
            onReadyTask = { taskId, _ -> tasks += taskId },
            onMonitoredMessage = { messages += it.id },
        )
        dispatchViberEvent(
            IncomingViberEvent.MonitoredMessage(
                com.viber.models.MonitoredMessageEvent(
                    id = 101,
                    instanceId = "emulator-a",
                    conversationId = 26,
                    token = "token",
                    date = "2026-09-05T12:00:00.000Z",
                    phoneSource = "none",
                ),
            ),
            onReadyTask = { taskId, _ -> tasks += taskId },
            onMonitoredMessage = { messages += it.id },
        )

        assertEquals(listOf("task-1"), tasks)
        assertEquals(listOf(101L), messages)
    }

    @Test
    fun `failed task is acknowledged so the following message is not starved`() = runBlocking {
        var persistedMessage = false
        val failedTask = handleViberEvent(
            IncomingViberEvent.ReadyTask("missing-dynamic-task"),
            onReadyTask = { _, _ -> error("dynamic bot unavailable") },
            onMonitoredMessage = {},
        )
        val followingMessage = handleViberEvent(
            IncomingViberEvent.MonitoredMessage(
                com.viber.models.MonitoredMessageEvent(
                    id = 101,
                    instanceId = "emulator-a",
                    conversationId = 26,
                    date = "2026-09-05T12:00:00.000Z",
                    phoneSource = "none",
                ),
            ),
            onReadyTask = { _, _ -> },
            onMonitoredMessage = { persistedMessage = true },
        )

        assertEquals(DeliveryDisposition.ACK, failedTask)
        assertEquals(DeliveryDisposition.ACK, followingMessage)
        assertEquals(true, persistedMessage)
    }

    @Test
    fun `ignores unrelated patterns and non-ready task updates`() {
        assertNull(
            decodeViberEvent(
                """{"pattern":"other.event","data":{}}""".encodeToByteArray(),
            ),
        )
        assertNull(
            decodeViberEvent(
                """{"pattern":"viber.task.event","data":{"taskId":"task-1","status":"running"}}"""
                    .encodeToByteArray(),
            ),
        )
    }
}
