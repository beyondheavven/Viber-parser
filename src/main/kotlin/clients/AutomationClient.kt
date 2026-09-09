package com.viber.clients

import com.viber.config.AutomationSettings
import com.viber.models.CollectParticipantsRequest
import com.viber.models.DecodeRequest
import com.viber.models.EnableMonitorGroupRequest
import com.viber.models.QueryOnlineStatusRequest
import com.viber.models.StartMonitorRequest
import com.viber.models.TaskCreatedResponse
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.engine.cio.CIO
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.request.post
import io.ktor.client.request.get
import io.ktor.client.request.parameter
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.contentType
import io.ktor.serialization.kotlinx.json.json

class AutomationClient(
    private val settings: AutomationSettings
) {
    private val client = HttpClient(CIO) {
        install(ContentNegotiation) { json() }
    }

    suspend fun collectParticipants(request: CollectParticipantsRequest): TaskCreatedResponse {
        return client.post("${settings.baseUrl}/api/participants/collect") {
            contentType(ContentType.Application.Json)
            setBody(request)
        }.body()
    }

    suspend fun getTaskParticipants(taskId: String): String {
        return client.get("${settings.baseUrl}/api/tasks/$taskId/participants").bodyAsText()
    }

    suspend fun getOnlineStatuses(request: QueryOnlineStatusRequest): String {
        return client.post("${settings.baseUrl}/api/participants/online-status") {
            contentType(ContentType.Application.Json)
            setBody(request)
        }.bodyAsText()
    }

    suspend fun getTasks(status: String? = null): String {
        return client.get("${settings.baseUrl}/api/tasks") {
            if (status != null) parameter("status", status)
        }.bodyAsText()
    }

    suspend fun getTask(taskId: String): String {
        return client.get("${settings.baseUrl}/api/tasks/$taskId").bodyAsText()
    }

    suspend fun stopTask(taskId: String): String {
        return client.post("${settings.baseUrl}/api/tasks/$taskId/stop").bodyAsText()
    }

    suspend fun getGroups(includeAll: Boolean = false): String {
        return client.get("${settings.baseUrl}/api/groups") {
            parameter("all", includeAll)
        }.bodyAsText()
    }

    suspend fun getGroup(id: Int): String {
        return client.get("${settings.baseUrl}/api/groups/$id").bodyAsText()
    }

    suspend fun getGroupParticipants(id: Int): String {
        return client.get("${settings.baseUrl}/api/groups/$id/participants").bodyAsText()
    }

    suspend fun syncDatabase(): String {
        return client.post("${settings.baseUrl}/api/database/sync").bodyAsText()
    }

    suspend fun getDatabaseStats(): String {
        return client.get("${settings.baseUrl}/api/database/stats").bodyAsText()
    }

    suspend fun decodeParticipants(request: DecodeRequest): String {
        return client.post("${settings.baseUrl}/api/database/decode") {
            contentType(ContentType.Application.Json)
            setBody(request)
        }.bodyAsText()
    }

    suspend fun startMonitor(request: StartMonitorRequest): String {
        return client.post("${settings.baseUrl}/api/messages/monitor/start") {
            contentType(ContentType.Application.Json)
            setBody(request)
        }.bodyAsText()
    }

    suspend fun stopMonitor(): String {
        return client.post("${settings.baseUrl}/api/messages/monitor/stop").bodyAsText()
    }

    suspend fun getMonitorStatus(): String {
        return client.get("${settings.baseUrl}/api/messages/monitor/status").bodyAsText()
    }

    suspend fun getMonitoredGroups(): String {
        return client.get("${settings.baseUrl}/api/messages/monitor/groups").bodyAsText()
    }

    suspend fun enableMonitorGroup(id: Int, request: EnableMonitorGroupRequest): String {
        return client.post("${settings.baseUrl}/api/messages/monitor/groups/$id/enable") {
            contentType(ContentType.Application.Json)
            setBody(request)
        }.bodyAsText()
    }

    suspend fun disableMonitorGroup(id: Int): String {
        return client.post("${settings.baseUrl}/api/messages/monitor/groups/$id/disable").bodyAsText()
    }

    suspend fun getMonitoredMessages(queryParams: Map<String, String>): String {
        return client.get("${settings.baseUrl}/api/messages/monitored") {
            queryParams.forEach { (key, value) -> parameter(key, value) }
        }.bodyAsText()
    }

}