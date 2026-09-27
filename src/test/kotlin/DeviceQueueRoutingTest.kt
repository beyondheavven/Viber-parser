package com.viber

import com.viber.bot.BotAuthClient
import com.viber.bot.DeviceQueueRouting
import com.viber.infrastructure.rabbitmq.RpcClient
import com.viber.bot.ViberBotClient
import com.viber.models.CodeRequest
import com.viber.models.LoginRequest
import com.viber.models.LoginResponse
import com.viber.models.QrStartRequest
import com.viber.plugins.configureException
import com.viber.routes.authRoutes
import com.viber.services.AuthService
import io.ktor.client.request.get
import io.ktor.client.request.post
import io.ktor.http.HttpStatusCode
import io.ktor.serialization.kotlinx.json.json
import io.ktor.server.application.install
import io.ktor.server.plugins.contentnegotiation.ContentNegotiation
import io.ktor.server.routing.routing
import io.ktor.server.testing.testApplication
import kotlinx.coroutines.runBlocking
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class DeviceQueueRoutingTest {
    private val deviceId = "a".repeat(64)
    private val expectedQueue = "viber_commands_queue.device.$deviceId"
    private val routingId = "136.92.24.88:5556"
    private val expectedRoutingQueue = "viber_commands_queue.device.$routingId"

    @Test
    fun `device queue is deterministic and rejects unsafe ids`() {
        assertEquals("viber_commands_queue", DeviceQueueRouting.queueName(null))
        assertEquals("viber_commands_queue", DeviceQueueRouting.queueName("default"))
        assertEquals("viber_commands_queue", DeviceQueueRouting.queueName("android-emulator"))
        assertEquals("viber_commands_queue", DeviceQueueRouting.queueName("emulator-5554"))
        assertEquals("viber_commands_queue", DeviceQueueRouting.queueName("main"))
        assertEquals(expectedQueue, DeviceQueueRouting.queueName(deviceId))
        assertEquals("viber_commands_queue.device.worker_1", DeviceQueueRouting.queueName("worker_1"))
        assertEquals(
            expectedRoutingQueue,
            DeviceQueueRouting.queueName(routingId)
        )

        listOf("", "../worker", "worker.name", "worker name", "host:0", "host:65536", "a".repeat(65)).forEach { invalid ->
            assertFailsWith<IllegalArgumentException> { DeviceQueueRouting.queueName(invalid) }
        }
    }

    @Test
    fun `all device scoped auth calls use the selected queue`() = runBlocking {
        val rpc = RecordingRpcClient()
        val client = ViberBotClient(rpc, "viber_commands_queue")

        client.enterPhoneNumber(LoginRequest(deviceId = routingId))
        client.enterCode(CodeRequest(code = "1234", deviceId = routingId))
        client.startQrLogin(QrStartRequest(deviceId = routingId))
        client.getQrLoginStatus(routingId)
        client.cancelQrLogin(routingId)

        assertEquals(List(5) { expectedRoutingQueue }, rpc.queues)
    }

    @Test
    fun `legacy auth calls keep using the default queue`() = runBlocking {
        val rpc = RecordingRpcClient()
        val client = ViberBotClient(rpc, "viber_commands_queue")

        client.startQrLogin(QrStartRequest())
        client.getQrLoginStatus(null)
        client.cancelQrLogin(null)

        assertEquals(List(3) { "viber_commands_queue" }, rpc.queues)
    }

    @Test
    fun `qr status and cancel forward device id from query`() = testApplication {
        val authClient = RecordingAuthClient()
        application {
            routing { authRoutes(AuthService(authClient)) }
        }

        assertEquals(HttpStatusCode.OK, client.get("/auth/qr/status?deviceId=136.92.24.88%3A5556").status)
        assertEquals(HttpStatusCode.OK, client.post("/auth/qr/cancel?deviceId=136.92.24.88%3A5556").status)
        assertEquals(listOf<String?>(routingId, routingId), authClient.deviceIds.toList())
    }

    @Test
    fun `qr routes reject unsafe device id`() = testApplication {
        application {
            install(ContentNegotiation) { json() }
            configureException()
            routing { authRoutes(AuthService(RecordingAuthClient())) }
        }

        assertEquals(HttpStatusCode.BadRequest, client.get("/auth/qr/status?deviceId=..%2Fqueue").status)
    }

    private class RecordingRpcClient : RpcClient {
        val queues = mutableListOf<String>()

        override suspend fun call(pattern: String, payload: Any?, queueName: String?): String {
            queues += requireNotNull(queueName)
            return if (pattern == "viber.auth.phone" || pattern == "viber.auth.code") {
                "{\"success\":true,\"message\":\"ok\"}"
            } else {
                "{}"
            }
        }
    }

    private class RecordingAuthClient : BotAuthClient {
        val deviceIds = mutableListOf<String?>()

        override suspend fun enterPhoneNumber(request: LoginRequest) = LoginResponse(true, "ok")
        override suspend fun enterCode(request: CodeRequest) = LoginResponse(true, "ok")
        override suspend fun getAuthStatus() = "{}"
        override suspend fun startQrLogin(request: QrStartRequest) = "{}"
        override suspend fun getQrLoginStatus(deviceId: String?): String {
            deviceIds += deviceId
            return "{}"
        }

        override suspend fun cancelQrLogin(deviceId: String?): String {
            deviceIds += deviceId
            return "{}"
        }
    }
}
