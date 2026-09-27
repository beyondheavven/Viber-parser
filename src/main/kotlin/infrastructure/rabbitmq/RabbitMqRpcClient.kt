package com.viber.infrastructure.rabbitmq

import com.rabbitmq.client.AMQP
import com.rabbitmq.client.Channel
import com.rabbitmq.client.Connection
import com.rabbitmq.client.ConnectionFactory
import com.rabbitmq.client.DefaultConsumer
import com.rabbitmq.client.Envelope
import com.viber.config.RabbitMqSettings
import io.ktor.http.HttpStatusCode
import io.ktor.utils.io.core.Closeable
import kotlinx.coroutines.future.await
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import org.slf4j.LoggerFactory
import java.util.UUID
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap
import kotlin.time.Duration.Companion.milliseconds

class MicroserviceException(
    val statusCode: HttpStatusCode,
    override val message: String
) : RuntimeException(message)

interface RpcClient {
    suspend fun call(pattern: String, payload: Any? = null, queueName: String? = null): String
}

class RabbitMqRpcClient(
    private val settings: RabbitMqSettings,
) : Closeable, RpcClient {

    private val logger = LoggerFactory.getLogger(RabbitMqRpcClient::class.java)

    private val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
    }

    private val connection: Connection

    private val channel: Channel

    private val replyQueueName = "amq.rabbitmq.reply-to"

    private val pendingRequests = ConcurrentHashMap<String, CompletableFuture<String>>()

    init {
        val factory = ConnectionFactory().apply {
            host = settings.host
            port = settings.port
            username = settings.user
            password = settings.pass
            isAutomaticRecoveryEnabled = true
        }

        logger.info("Connecting to RabbitMQ at ${settings.host}:${settings.port}...")
        connection = factory.newConnection("ktor-rpc-client")
        channel = connection.createChannel()

        channel.queueDeclare(settings.queue, true, false, false, null)

        channel.basicConsume(replyQueueName, true, object : DefaultConsumer(channel) {
            override fun handleDelivery(
                consumerTag: String,
                envelope: Envelope,
                properties: AMQP.BasicProperties,
                body: ByteArray
            ) {
                val correlationId = properties.correlationId
                if (correlationId == null) {
                    logger.warn("Received message without correlationId")
                    return
                }

                val future = pendingRequests.remove(correlationId)
                if (future == null) {
                    logger.warn("No pending request for correlationId: $correlationId")
                    return
                }

                val responseString = String(body, Charsets.UTF_8)
                future.complete(responseString)
            }
        })

        logger.info("RabbitMQ RPC client connected. Target queue: ${settings.queue}")
    }

    override suspend fun call(pattern: String, payload: Any?, queueName: String?): String {
        val targetQueue = queueName ?: settings.queue
        channel.queueDeclare(targetQueue, true, false, false, null)
        val correlationId = UUID.randomUUID().toString()
        val future = CompletableFuture<String>()
        pendingRequests[correlationId] = future

        val messageJson = buildNestJsMessage(pattern, payload, correlationId)
        val props = AMQP.BasicProperties.Builder()
            .correlationId(correlationId)
            .replyTo(replyQueueName)
            .contentType("application/json")
            .build()

        channel.basicPublish("", targetQueue, props, messageJson.toByteArray(Charsets.UTF_8))

        return try {
            withTimeout(settings.timeout.toMillis().milliseconds) {
                val rawResponse = future.await()
                extractNestJsResponse(rawResponse)
            }
        } catch (e: Exception) {
            pendingRequests.remove(correlationId)
            logger.error("RPC call failed for pattern '$pattern': ${e.message}")
            throw e
        }
    }

    private fun buildNestJsMessage(pattern: String, data: Any?, id: String): String {
        val dataJsonElement: JsonElement = when (data) {
            null -> JsonNull
            is JsonElement -> data
            is String -> {
                try {
                    json.parseToJsonElement(data)
                } catch (_: Exception) {
                    JsonPrimitive(data)
                }
            }
            is Number -> JsonPrimitive(data)
            is Boolean -> JsonPrimitive(data)
            is Map<*, *> -> {
                val entries = data.entries.associate {
                    it.key.toString() to (it.value?.let { v -> JsonPrimitive(v.toString()) } ?: JsonNull)
                }
                JsonObject(entries)
            }
            else -> JsonPrimitive(data.toString())
        }

        val requestObj = JsonObject(
            mapOf(
                "pattern" to JsonPrimitive(pattern),
                "data" to dataJsonElement,
                "id" to JsonPrimitive(id)
            )
        )

        return json.encodeToString(JsonObject.serializer(), requestObj)
    }

    private fun extractNestJsResponse(rawResponse: String): String {
        val root = json.parseToJsonElement(rawResponse).jsonObject

        val errElement = root["err"]
        if (errElement != null && errElement !is JsonNull) {
            val errorMsg = errElement.toString()
            logger.error("Error returned from bot: $errorMsg")
            if (errElement is JsonObject) {
                val statusCodeInt = (errElement["statusCode"] as? JsonPrimitive)?.content?.toIntOrNull() ?: 500
                val messageStr = (errElement["message"] as? JsonPrimitive)?.content ?: errorMsg
                throw MicroserviceException(HttpStatusCode.fromValue(statusCodeInt), messageStr)
            }
            throw MicroserviceException(HttpStatusCode.InternalServerError, errorMsg)
        }

        val responseElement = root["response"] ?: return "{}"
        return responseElement.toString()
    }

    override fun close() {
        try {
            channel.close()
            connection.close()
        } catch (e: Exception) {
            logger.warn("Error closing RabbitMQ client: ${e.message}")
        }
    }
}
