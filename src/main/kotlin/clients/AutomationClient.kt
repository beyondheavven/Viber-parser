package com.viber.clients

import com.viber.config.RabbitMqSettings
import com.viber.models.CollectParticipantsRequest
import com.viber.models.DecodeRequest
import com.viber.models.EnableMonitorGroupRequest
import com.viber.models.QueryOnlineStatusRequest
import com.viber.models.StartMonitorRequest
import com.viber.models.TaskCreatedResponse
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

class AutomationClient(
    private val rpcClient: RabbitMqRpcClient
) {
    constructor(settings: RabbitMqSettings) : this(RabbitMqRpcClient(settings))

    private val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
    }

    suspend fun collectParticipants(request: CollectParticipantsRequest): TaskCreatedResponse {
        val raw = rpcClient.call("viber.participants.collect", json.encodeToString(request))
        return json.decodeFromString(raw)
    }

    suspend fun getTaskParticipants(taskId: String): String {
        return rpcClient.call("viber.participants.get_task_participants", mapOf("id" to taskId))
    }

    suspend fun getOnlineStatuses(request: QueryOnlineStatusRequest): String {
        return rpcClient.call("viber.participants.online_status", json.encodeToString(request))
    }

    suspend fun getTasks(status: String? = null): String {
        val payload = if (status != null) mapOf("status" to status) else emptyMap<String, String>()
        return rpcClient.call("viber.tasks.get_all", payload)
    }

    suspend fun getTask(taskId: String): String {
        return rpcClient.call("viber.tasks.get_by_id", mapOf("id" to taskId))
    }

    suspend fun stopTask(taskId: String): String {
        return rpcClient.call("viber.tasks.stop", mapOf("id" to taskId))
    }

    suspend fun getGroups(includeAll: Boolean = false): String {
        return rpcClient.call("viber.groups.get_all", mapOf("all" to includeAll))
    }

    suspend fun getGroup(id: Int): String {
        return rpcClient.call("viber.groups.get_by_id", mapOf("id" to id))
    }

    suspend fun getGroupParticipants(id: Int): String {
        return rpcClient.call("viber.groups.get_participants", mapOf("id" to id))
    }

    suspend fun syncDatabase(): String {
        return rpcClient.call("viber.database.sync")
    }

    suspend fun getDatabaseStats(): String {
        return rpcClient.call("viber.database.stats")
    }

    suspend fun decodeParticipants(request: DecodeRequest): String {
        return rpcClient.call("viber.database.decode", json.encodeToString(request))
    }

    suspend fun startMonitor(request: StartMonitorRequest): String {
        return rpcClient.call("viber.messages.monitor.start", json.encodeToString(request))
    }

    suspend fun stopMonitor(): String {
        return rpcClient.call("viber.messages.monitor.stop")
    }

    suspend fun getMonitorStatus(): String {
        return rpcClient.call("viber.messages.monitor.status")
    }

    suspend fun getMonitoredGroups(): String {
        return rpcClient.call("viber.messages.monitor.groups")
    }

    suspend fun enableMonitorGroup(id: Int, request: EnableMonitorGroupRequest): String {
        return rpcClient.call(
            "viber.messages.monitor.enable_group",
            mapOf("id" to id, "dto" to json.encodeToString(request))
        )
    }

    suspend fun disableMonitorGroup(id: Int): String {
        return rpcClient.call("viber.messages.monitor.disable_group", mapOf("id" to id))
    }

    suspend fun getMonitoredMessages(queryParams: Map<String, String>): String {
        return rpcClient.call("viber.messages.get_monitored", queryParams)
    }
}