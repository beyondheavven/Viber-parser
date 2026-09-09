package com.viber.clients

import com.viber.config.AutomationSettings
import com.viber.models.CollectParticipantsRequest
import com.viber.models.QueryOnlineStatusRequest
import com.viber.models.TaskCreatedResponse
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.engine.cio.CIO
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.request.post
import io.ktor.client.request.get
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

    suspend fun getTasks(): String {
        return client.get("${settings.baseUrl}/api/tasks").bodyAsText()
    }

    suspend fun getTask(taskId: String): String {
        return client.get("${settings.baseUrl}/api/tasks/$taskId").bodyAsText()
    }

    suspend fun stopTask(taskId: String): String {
        return client.post("${settings.baseUrl}/api/tasks/$taskId/stop").bodyAsText()
    }

    suspend fun getGroups(): String {
        return client.get("${settings.baseUrl}/api/groups").bodyAsText()
    }

    suspend fun getGroup(id: Int): String {
        return client.get("${settings.baseUrl}/api/groups/$id").bodyAsText()
    }

    suspend fun syncDatabase(): String {
        return client.post("${settings.baseUrl}/api/database/sync").bodyAsText()
    }

    suspend fun startMonitor(): String {
        return client.post("${settings.baseUrl}/api/messages/monitor/start").bodyAsText()
    }

    suspend fun stopMonitor(): String {
        return client.post("${settings.baseUrl}/api/messages/monitor/stop").bodyAsText()
    }


}