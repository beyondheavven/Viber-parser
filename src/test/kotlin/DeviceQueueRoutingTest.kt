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
import com.viber.routes.broadcastRoutes
import com.viber.routes.tasksRoutes
import com.viber.services.AuthService
import io.ktor.client.request.delete
import io.ktor.client.request.get
import io.ktor.client.request.patch
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
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

    @Test
    fun `task routes forward device id to the selected queue`() = testApplication {
        val rpc = RecordingRpcClient()
        application {
            routing { tasksRoutes(ViberBotClient(rpc, "viber_commands_queue")) }
        }

        assertEquals(HttpStatusCode.OK, client.get("/tasks?deviceId=136.92.24.88%3A5556").status)
        assertEquals(HttpStatusCode.OK, client.get("/tasks/task-1?deviceId=136.92.24.88%3A5556").status)
        assertEquals(
            HttpStatusCode.OK,
            client.get("/tasks/task-1/participants?deviceId=136.92.24.88%3A5556").status
        )
        assertEquals(
            HttpStatusCode.OK,
            client.post("/tasks/task-1/stop?deviceId=136.92.24.88%3A5556").status
        )

        assertEquals(List(4) { expectedRoutingQueue }, rpc.queues)
    }

    @Test
    fun `task routes without device id keep using the default queue`() = testApplication {
        val rpc = RecordingRpcClient()
        application {
            routing { tasksRoutes(ViberBotClient(rpc, "viber_commands_queue")) }
        }

        assertEquals(HttpStatusCode.OK, client.get("/tasks").status)
        assertEquals(HttpStatusCode.OK, client.get("/tasks/task-1").status)
        assertEquals(HttpStatusCode.OK, client.get("/tasks/task-1/participants").status)
        assertEquals(HttpStatusCode.OK, client.post("/tasks/task-1/stop").status)

        assertEquals(List(4) { "viber_commands_queue" }, rpc.queues)
    }

    @Test
    fun `task routes reject unsafe device id`() = testApplication {
        application {
            install(ContentNegotiation) { json() }
            configureException()
            routing { tasksRoutes(ViberBotClient(RecordingRpcClient(), "viber_commands_queue")) }
        }

        assertEquals(HttpStatusCode.BadRequest, client.get("/tasks?deviceId=..%2Fqueue").status)
    }

    @Test
    fun `all broadcast routes forward device id to the selected queue`() = testApplication {
        val rpc = RecordingRpcClient()
        application {
            install(ContentNegotiation) { json() }
            routing { broadcastRoutes(ViberBotClient(rpc, "viber_commands_queue")) }
        }
        val query = "deviceId=136.92.24.88%3A5556"

        assertEquals(HttpStatusCode.OK, client.get("/broadcast/status?$query").status)
        assertEquals(HttpStatusCode.OK, client.get("/broadcast/history/last?$query").status)
        assertEquals(HttpStatusCode.OK, client.get("/broadcast/history?$query").status)
        assertEquals(HttpStatusCode.OK, client.get("/broadcast/campaigns?$query").status)
        assertEquals(HttpStatusCode.Created, client.post("/broadcast/campaigns?$query") {
            contentType(ContentType.Application.Json)
            setBody("""{"conversationIds":[1],"messages":["hello"],"intervalMs":5000}""")
        }.status)
        assertEquals(HttpStatusCode.OK, client.get("/broadcast/campaigns/campaign-1?$query").status)
        assertEquals(HttpStatusCode.OK, client.patch("/broadcast/campaigns/campaign-1?$query") {
            contentType(ContentType.Application.Json)
            setBody("""{"name":"updated"}""")
        }.status)
        assertEquals(HttpStatusCode.OK, client.delete("/broadcast/campaigns/campaign-1?$query").status)
        assertEquals(HttpStatusCode.OK, client.post("/broadcast/campaigns/campaign-1/start?$query").status)
        assertEquals(HttpStatusCode.OK, client.post("/broadcast/campaigns/campaign-1/stop?$query").status)

        assertEquals(List(10) { expectedRoutingQueue }, rpc.queues)
    }

    @Test
    fun `broadcast routes without device id keep using the default queue`() = testApplication {
        val rpc = RecordingRpcClient()
        application {
            install(ContentNegotiation) { json() }
            routing { broadcastRoutes(ViberBotClient(rpc, "viber_commands_queue")) }
        }

        assertEquals(HttpStatusCode.OK, client.get("/broadcast/status").status)
        assertEquals(HttpStatusCode.OK, client.get("/broadcast/history/last").status)
        assertEquals(HttpStatusCode.OK, client.get("/broadcast/history").status)
        assertEquals(HttpStatusCode.OK, client.get("/broadcast/campaigns").status)
        assertEquals(HttpStatusCode.Created, client.post("/broadcast/campaigns") {
            contentType(ContentType.Application.Json)
            setBody("""{"conversationIds":[1],"messages":["hello"],"intervalMs":5000}""")
        }.status)
        assertEquals(HttpStatusCode.OK, client.get("/broadcast/campaigns/campaign-1").status)
        assertEquals(HttpStatusCode.OK, client.patch("/broadcast/campaigns/campaign-1") {
            contentType(ContentType.Application.Json)
            setBody("""{"name":"updated"}""")
        }.status)
        assertEquals(HttpStatusCode.OK, client.delete("/broadcast/campaigns/campaign-1").status)
        assertEquals(HttpStatusCode.OK, client.post("/broadcast/campaigns/campaign-1/start").status)
        assertEquals(HttpStatusCode.OK, client.post("/broadcast/campaigns/campaign-1/stop").status)

        assertEquals(List(10) { "viber_commands_queue" }, rpc.queues)
    }

    @Test
    fun `broadcast routes reject unsafe device id before rpc`() = testApplication {
        val rpc = RecordingRpcClient()
        application {
            install(ContentNegotiation) { json() }
            configureException()
            routing { broadcastRoutes(ViberBotClient(rpc, "viber_commands_queue")) }
        }
        val query = "deviceId=..%2Fqueue"

        assertEquals(HttpStatusCode.BadRequest, client.get("/broadcast/status?$query").status)
        assertEquals(HttpStatusCode.BadRequest, client.get("/broadcast/history/last?$query").status)
        assertEquals(HttpStatusCode.BadRequest, client.get("/broadcast/history?$query").status)
        assertEquals(HttpStatusCode.BadRequest, client.get("/broadcast/campaigns?$query").status)
        assertEquals(HttpStatusCode.BadRequest, client.post("/broadcast/campaigns?$query") {
            contentType(ContentType.Application.Json)
            setBody("""{"conversationIds":[1],"messages":["hello"],"intervalMs":5000}""")
        }.status)
        assertEquals(HttpStatusCode.BadRequest, client.get("/broadcast/campaigns/campaign-1?$query").status)
        assertEquals(HttpStatusCode.BadRequest, client.patch("/broadcast/campaigns/campaign-1?$query") {
            contentType(ContentType.Application.Json)
            setBody("""{"name":"updated"}""")
        }.status)
        assertEquals(HttpStatusCode.BadRequest, client.delete("/broadcast/campaigns/campaign-1?$query").status)
        assertEquals(HttpStatusCode.BadRequest, client.post("/broadcast/campaigns/campaign-1/start?$query").status)
        assertEquals(HttpStatusCode.BadRequest, client.post("/broadcast/campaigns/campaign-1/stop?$query").status)

        assertEquals(emptyList(), rpc.queues)
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
