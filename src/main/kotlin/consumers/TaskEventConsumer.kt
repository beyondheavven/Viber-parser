package com.viber.consumers

import com.rabbitmq.client.AMQP
import com.rabbitmq.client.Channel
import com.rabbitmq.client.Connection
import com.rabbitmq.client.ConnectionFactory
import com.rabbitmq.client.DefaultConsumer
import com.rabbitmq.client.Envelope
import com.viber.config.RabbitMqSettings
import com.viber.models.MonitoredMessageEvent
import io.ktor.utils.io.core.Closeable
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.slf4j.LoggerFactory
import java.nio.charset.StandardCharsets
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors


internal sealed interface IncomingViberEvent {
    data class ReadyTask(val taskId: String, val instanceId: String = "default") : IncomingViberEvent
    data class MonitoredMessage(val message: MonitoredMessageEvent) : IncomingViberEvent
}

internal enum class DeliveryDisposition { ACK, REQUEUE }

private val eventJson = Json { ignoreUnknownKeys = true }

internal fun decodeViberEvent(body: ByteArray): IncomingViberEvent? {
    val payload = eventJson.parseToJsonElement(String(body, StandardCharsets.UTF_8)).jsonObject
    val data = payload["data"]?.jsonObject ?: return null
    return when (payload["pattern"]?.jsonPrimitive?.contentOrNull) {
        "viber.task.event" -> {
            if (data["status"]?.jsonPrimitive?.contentOrNull != "ready") return null
            val taskId = data["taskId"]?.jsonPrimitive?.contentOrNull ?: return null
            val instanceId = data["instanceId"]?.jsonPrimitive?.contentOrNull ?: "default"
            IncomingViberEvent.ReadyTask(taskId, instanceId)
        }
        "viber.message.received" ->
            IncomingViberEvent.MonitoredMessage(eventJson.decodeFromJsonElement(data))
        else -> null
    }
}

internal suspend fun dispatchViberEvent(
    event: IncomingViberEvent?,
    onReadyTask: suspend (String, String) -> Unit,
    onMonitoredMessage: suspend (MonitoredMessageEvent) -> Unit,
) {
    when (event) {
        is IncomingViberEvent.ReadyTask -> onReadyTask(event.taskId, event.instanceId)
        is IncomingViberEvent.MonitoredMessage -> onMonitoredMessage(event.message)
        null -> Unit
    }
}

internal suspend fun handleViberEvent(
    event: IncomingViberEvent?,
    onReadyTask: suspend (String, String) -> Unit,
    onMonitoredMessage: suspend (MonitoredMessageEvent) -> Unit,
): DeliveryDisposition = try {
    dispatchViberEvent(event, onReadyTask, onMonitoredMessage)
    DeliveryDisposition.ACK
} catch (e: Exception) {
    if (e is CancellationException) throw e
    if (event is IncomingViberEvent.MonitoredMessage) {
        DeliveryDisposition.REQUEUE
    } else {
        DeliveryDisposition.ACK
    }
}

class TaskEventConsumer(
    private val settings: RabbitMqSettings,
    private val onReadyTask: suspend (taskId: String, instanceId: String) -> Unit,
    private val onMonitoredMessage: suspend (message: MonitoredMessageEvent) -> Unit = {},
) : Closeable {

    private val logger = LoggerFactory.getLogger(TaskEventConsumer::class.java)
    private val worker = Executors.newSingleThreadExecutor { r -> Thread(r, "task-event-sync") }
    private val scope = CoroutineScope(SupervisorJob() + worker.asCoroutineDispatcher())

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
        channel.basicQos(1)
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
                    scope.launch {
                        handle(envelope.deliveryTag, body)
                    }
                }
            },
        )
        logger.info(
            "Listening for task and monitored-message events on '{}' for Supabase persistence.",
            settings.eventsQueue,
        )
    }

    private suspend fun handle(deliveryTag: Long, body: ByteArray) {
        val event = try {
            decodeViberEvent(body)
        } catch (e: Exception) {
            logger.warn("Discarding malformed Viber event: {}", e.message)
            channel.basicAck(deliveryTag, false)
            return
        }
        val disposition = handleViberEvent(
            event = event,
            onReadyTask = { taskId, instanceId ->
                val handledKey = "$instanceId:$taskId"
                if (handled.add(handledKey)) {
                    try {
                        onReadyTask(taskId, instanceId)
                    } catch (e: Exception) {
                        handled.remove(handledKey)
                        logger.warn("Failed to handle ready task {}; acknowledging: {}", taskId, e.message)
                        throw e
                    }
                }
            },
            onMonitoredMessage = { message ->
                try {
                    onMonitoredMessage(message)
                } catch (e: Exception) {
                    logger.warn("Failed to persist a monitored message; requeueing: {}", e.message)
                    throw e
                }
            },
        )
        if (disposition == DeliveryDisposition.ACK) {
            channel.basicAck(deliveryTag, false)
        } else {
            channel.basicNack(deliveryTag, false, true)
        }
    }

    override fun close() {
        runCatching { channel.close() }
        runCatching { connection.close() }
        scope.cancel()
        worker.shutdown()
    }
}
