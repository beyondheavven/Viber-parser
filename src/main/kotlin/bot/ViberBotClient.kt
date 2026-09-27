package com.viber.bot

import com.viber.config.RabbitMqSettings
import com.viber.infrastructure.rabbitmq.RabbitMqRpcClient
import com.viber.infrastructure.rabbitmq.RpcClient
import com.viber.models.CollectParticipantsRequest
import com.viber.models.CreateCampaignRequest
import com.viber.models.UpdateCampaignRequest
import com.viber.models.DecodeRequest
import com.viber.models.EnableMonitorGroupRequest
import com.viber.models.GroupSummary
import com.viber.models.QueryOnlineStatusRequest
import com.viber.models.StartMonitorRequest
import com.viber.models.CodeRequest
import com.viber.models.LoginRequest
import com.viber.models.LoginResponse
import com.viber.models.QrStartRequest
import com.viber.models.TaskCreatedResponse
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.encodeToJsonElement
import kotlinx.serialization.json.put

interface BotAuthClient {
    suspend fun enterPhoneNumber(request: LoginRequest): LoginResponse
    suspend fun enterCode(request: CodeRequest): LoginResponse
    suspend fun getAuthStatus(): String
    suspend fun startQrLogin(request: QrStartRequest): String
    suspend fun getQrLoginStatus(deviceId: String? = null): String
    suspend fun cancelQrLogin(deviceId: String? = null): String
}

class ViberBotClient(
    private val rpcClient: RpcClient,
    private val defaultQueue: String,
) : RosterClient, BotAuthClient {
    constructor(settings: RabbitMqSettings) : this(RabbitMqRpcClient(settings), settings.queue)

    private val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
    }

    private val sparseJson = Json {
        ignoreUnknownKeys = true
        encodeDefaults = false
        explicitNulls = false
    }

    suspend fun collectParticipants(request: CollectParticipantsRequest): TaskCreatedResponse {
        val raw = rpcClient.call("viber.participants.collect", json.encodeToString(request))
        return json.decodeFromString(raw)
    }

    override suspend fun getTaskParticipants(taskId: String): String {
        return rpcClient.call("viber.participants.get_task_participants", mapOf("id" to taskId))
    }

    suspend fun getOnlineStatuses(request: QueryOnlineStatusRequest): String {
        return rpcClient.call("viber.participants.online_status", json.encodeToString(request))
    }

    suspend fun getTasks(status: String? = null): String {
        val payload = if (status != null) mapOf("status" to status) else emptyMap<String, String>()
        return rpcClient.call("viber.tasks.get_all", payload)
    }

    override suspend fun getTask(taskId: String): String {
        return rpcClient.call("viber.tasks.get_by_id", mapOf("id" to taskId))
    }

    suspend fun stopTask(taskId: String): String {
        return rpcClient.call("viber.tasks.stop", mapOf("id" to taskId))
    }

    override suspend fun getGroups(includeAll: Boolean): String {
        return rpcClient.call("viber.groups.get_all", mapOf("all" to includeAll))
    }

    override suspend fun getGroup(id: Int): String {
        return rpcClient.call("viber.groups.get_by_id", mapOf("id" to id))
    }

    override suspend fun getGroupParticipants(id: Int): String {
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

    suspend fun findConversationIdByGroupKey(groupKey: String): Int? {
        val groups = json.decodeFromString<List<GroupSummary>>(getGroups(includeAll = true))
        return groups.firstOrNull { it.groupId == groupKey }?.id
            ?: groups.firstOrNull { it.groupId.isNullOrBlank() && it.id.toString() == groupKey }?.id
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

    override suspend fun enterPhoneNumber(request: LoginRequest): LoginResponse {
        val raw = rpcClient.call("viber.auth.phone", json.encodeToString(request), authQueue(request.deviceId))
        return json.decodeFromString(raw)
    }

    override suspend fun enterCode(request: CodeRequest): LoginResponse {
        val raw = rpcClient.call("viber.auth.code", json.encodeToString(request), authQueue(request.deviceId))
        return json.decodeFromString(raw)
    }

    override suspend fun getAuthStatus(): String {
        return rpcClient.call("viber.auth.status")
    }

    override suspend fun startQrLogin(request: QrStartRequest): String {
        return rpcClient.call("viber.auth.qr.start", sparseJson.encodeToString(request), authQueue(request.deviceId))
    }

    override suspend fun getQrLoginStatus(deviceId: String?): String {
        return rpcClient.call("viber.auth.qr.status", queueName = authQueue(deviceId))
    }

    override suspend fun cancelQrLogin(deviceId: String?): String {
        return rpcClient.call("viber.auth.qr.cancel", queueName = authQueue(deviceId))
    }

    private fun authQueue(deviceId: String?): String = DeviceQueueRouting.queueName(deviceId, defaultQueue)


    suspend fun getBroadcastStatus(): String {
        return rpcClient.call("viber.broadcast.status")
    }

    suspend fun getBroadcastHistory(conversationId: Int? = null, campaignId: String? = null, limit: Int? = null): String {
        val payload = buildJsonObject {
            conversationId?.let { put("conversationId", it) }
            campaignId?.let { put("campaignId", it) }
            limit?.let { put("limit", it) }
        }
        return rpcClient.call("viber.broadcast.history", payload)
    }

    suspend fun getBroadcastLastSends(): String {
        return rpcClient.call("viber.broadcast.history.last")
    }

    suspend fun listCampaigns(): String {
        return rpcClient.call("viber.broadcast.campaigns.list")
    }

    suspend fun getCampaign(id: String): String {
        return rpcClient.call("viber.broadcast.campaigns.get", mapOf("id" to id))
    }

    suspend fun createCampaign(request: CreateCampaignRequest): String {
        return rpcClient.call("viber.broadcast.campaigns.create", sparseJson.encodeToString(request))
    }

    suspend fun updateCampaign(id: String, request: UpdateCampaignRequest): String {
        val changes = sparseJson.encodeToJsonElement(request) as JsonObject
        val payload = JsonObject(changes + ("id" to JsonPrimitive(id)))
        return rpcClient.call("viber.broadcast.campaigns.update", payload)
    }

    suspend fun deleteCampaign(id: String): String {
        return rpcClient.call("viber.broadcast.campaigns.delete", mapOf("id" to id))
    }

    suspend fun startCampaign(id: String): String {
        return rpcClient.call("viber.broadcast.campaigns.start", mapOf("id" to id))
    }

    suspend fun stopCampaign(id: String): String {
        return rpcClient.call("viber.broadcast.campaigns.stop", mapOf("id" to id))
    }

}
