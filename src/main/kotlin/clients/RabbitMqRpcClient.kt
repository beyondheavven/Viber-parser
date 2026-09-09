package com.viber.clients

import com.rabbitmq.client.AMQP
import com.rabbitmq.client.Channel
import com.rabbitmq.client.Connection
import com.rabbitmq.client.ConnectionFactory
import com.rabbitmq.client.DefaultConsumer
import com.rabbitmq.client.Envelope
import com.viber.config.RabbitMqSettings
import io.ktor.utils.io.core.Closeable
import kotlinx.coroutines.future.await
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.jsonObject
import org.slf4j.LoggerFactory
import java.util.UUID
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap

class RabbitMqRpcClient(
    private val settings: RabbitMqSettings,
) : Closeable {
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

        // Убеждаемся, что очередь команд существует
        channel.queueDeclare(settings.queue, true, false, false, null)

        // Слушаем Direct Reply-To для мгновенных RPC-ответов от NestJS
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

    suspend fun call(pattern: String, payload: Any? = null): String {
        val correlationId = UUID.randomUUID().toString()
        val future = CompletableFuture<String>()
        pendingRequests[correlationId] = future

        val messageJson = buildNestJsMessage(pattern, payload, correlationId)
        val props = AMQP.BasicProperties.Builder()
            .correlationId(correlationId)
            .replyTo(replyQueueName)
            .contentType("application/json")
            .build()

        channel.basicPublish("", settings.queue, props, messageJson.toByteArray(Charsets.UTF_8))

        return try {
            withTimeout(settings.timeout.toMillis()) {
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
            is String -> json.parseToJsonElement(data)
            is Number, is Boolean -> json.parseToJsonElement(data.toString())
            is Map<*, *> -> {
                val stringifiedMap = data.entries.associate { it.key.toString() to it.value?.toString() }
                json.encodeToJsonElement(kotlinx.serialization.serializer(), stringifiedMap)
            }
            else -> {
                try {
                    json.encodeToString(data)
                        .let { json.parseToJsonElement(it) }
                } catch (_: Exception) {
                    json.parseToJsonElement(json.encodeToString(data.toString()))
                }
            }
        }

        val requestObj = mapOf(
            "pattern" to pattern,
            "data" to dataJsonElement,
            "id" to id
        )

        return json.encodeToString(requestObj)
    }

    private fun extractNestJsResponse(rawResponse: String): String {
        val root = json.parseToJsonElement(rawResponse).jsonObject

        // Проверяем наличие ошибки от NestJS: { "err": ..., "response": ... }
        val errElement = root["err"]
        if (errElement != null && errElement !is JsonNull) {
            val errorMsg = errElement.toString()
            logger.error("Error returned from bot: $errorMsg")
            throw RuntimeException("Microservice error: $errorMsg")
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
