package com.viber.clients

import com.rabbitmq.client.AMQP
import com.rabbitmq.client.Channel
import com.rabbitmq.client.Connection
import com.rabbitmq.client.ConnectionFactory
import com.rabbitmq.client.DefaultConsumer
import com.rabbitmq.client.Envelope
import com.viber.config.RabbitMqSettings
import io.ktor.utils.io.core.Closeable
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.slf4j.LoggerFactory
import java.nio.charset.StandardCharsets
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors


class TaskEventConsumer(
    private val settings: RabbitMqSettings,
    private val onReadyTask: suspend (taskId: String) -> Unit,
) : Closeable {

    private val logger = LoggerFactory.getLogger(TaskEventConsumer::class.java)
    private val json = Json { ignoreUnknownKeys = true }

    /** One worker, so a big roster syncs on its own rather than several at once. */
    private val worker = Executors.newSingleThreadExecutor { r -> Thread(r, "task-event-sync") }
    private val scope = CoroutineScope(SupervisorJob() + worker.asCoroutineDispatcher())

    /** Tasks already handed to a sync, so a redelivery does not sync them twice. */
    private val handled: MutableSet<String> = ConcurrentHashMap.newKeySet()

    private val connection: Connection
    private val channel: Channel

    init {
        val factory = ConnectionFactory().apply {
            host = settings.host
            port = settings.port
            username = settings.user
            password = settings.pass
            isAutomaticRecoveryEnabled = true
        }
        connection = factory.newConnection("ktor-task-event-consumer")
        channel = connection.createChannel()
        channel.basicQos(20)
        channel.queueDeclare(settings.eventsQueue, true, false, false, null)
        channel.basicConsume(
            settings.eventsQueue,
            false,
            object : DefaultConsumer(channel) {
                override fun handleDelivery(
                    consumerTag: String,
                    envelope: Envelope,
                    properties: AMQP.BasicProperties,
                    body: ByteArray,
                ) {
                    try {
                        handle(body)
                    } catch (e: Exception) {
                        logger.warn("Failed to handle a task event: {}", e.message)
                    } finally {
                        channel.basicAck(envelope.deliveryTag, false)
                    }
                }
            },
        )
        logger.info(
            "Listening for task events on '{}' to auto-sync finished rosters to Supabase.",
            settings.eventsQueue,
        )
    }

    private fun handle(body: ByteArray) {
        val payload = json.parseToJsonElement(String(body, StandardCharsets.UTF_8)).jsonObject
        if (payload["pattern"]?.jsonPrimitive?.contentOrNull != TASK_EVENT_PATTERN) return

        val data = payload["data"]?.jsonObject ?: return
        if (data["status"]?.jsonPrimitive?.contentOrNull != READY_STATUS) return
        val taskId = data["taskId"]?.jsonPrimitive?.contentOrNull ?: return
        if (!handled.add(taskId)) return

        scope.launch {
            try {
                onReadyTask(taskId)
            } catch (e: Exception) {
                logger.warn("Auto-sync of task {} failed: {}", taskId, e.message)
            }
        }
    }

    override fun close() {
        runCatching { channel.close() }
        runCatching { connection.close() }
        scope.cancel()
        worker.shutdown()
    }

    private companion object {
        const val TASK_EVENT_PATTERN = "viber.task.event"
        const val READY_STATUS = "ready"
    }
}
