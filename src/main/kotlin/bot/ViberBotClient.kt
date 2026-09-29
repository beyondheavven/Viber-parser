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
import com.viber.models.CallRequest
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
    suspend fun requestCall(request: CallRequest): LoginResponse
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
        val raw = rpcClient.call("viber.participants.collect", json.encodeToString(request), authQueue(request.deviceId))
        return json.decodeFromString(raw)
    }

    override suspend fun getTaskParticipants(taskId: String): String = getTaskParticipants(taskId, null)

    override suspend fun getTaskParticipants(taskId: String, deviceId: String?): String {
        return rpcClient.call("viber.participants.get_task_participants", mapOf("id" to taskId), queueName = authQueue(deviceId))
    }

    suspend fun getOnlineStatuses(request: QueryOnlineStatusRequest, deviceId: String? = null): String {
        return rpcClient.call("viber.participants.online_status", json.encodeToString(request), queueName = authQueue(deviceId))
    }

    suspend fun getTasks(status: String? = null, deviceId: String? = null): String {
        val payload = if (status != null) mapOf("status" to status) else emptyMap<String, String>()
        return rpcClient.call("viber.tasks.get_all", payload, queueName = authQueue(deviceId))
    }

    override suspend fun getTask(taskId: String): String = getTask(taskId, null)

    override suspend fun getTask(taskId: String, deviceId: String?): String {
        return rpcClient.call("viber.tasks.get_by_id", mapOf("id" to taskId), queueName = authQueue(deviceId))
    }

    suspend fun stopTask(taskId: String, deviceId: String? = null): String {
        return rpcClient.call("viber.tasks.stop", mapOf("id" to taskId), queueName = authQueue(deviceId))
    }

    override suspend fun getGroups(includeAll: Boolean): String = getGroups(includeAll, null)

    override suspend fun getGroups(includeAll: Boolean, deviceId: String?): String {
        return rpcClient.call("viber.groups.get_all", mapOf("all" to includeAll), queueName = authQueue(deviceId))
    }

    override suspend fun getGroup(id: Int): String = getGroup(id, null)

    override suspend fun getGroup(id: Int, deviceId: String?): String {
        return rpcClient.call("viber.groups.get_by_id", mapOf("id" to id), queueName = authQueue(deviceId))
    }

    override suspend fun getGroupParticipants(id: Int): String = getGroupParticipants(id, null)

    override suspend fun getGroupParticipants(id: Int, deviceId: String?): String {
        return rpcClient.call("viber.groups.get_participants", mapOf("id" to id), queueName = authQueue(deviceId))
    }

    suspend fun syncDatabase(deviceId: String? = null): String {
        return rpcClient.call("viber.database.sync", queueName = authQueue(deviceId))
    }

    suspend fun getDatabaseStats(deviceId: String? = null): String {
        return rpcClient.call("viber.database.stats", queueName = authQueue(deviceId))
    }

    suspend fun decodeParticipants(request: DecodeRequest, deviceId: String? = null): String {
        return rpcClient.call("viber.database.decode", json.encodeToString(request), queueName = authQueue(deviceId))
    }

    suspend fun startMonitor(request: StartMonitorRequest, deviceId: String? = null): String {
        val targetDevice = request.deviceId ?: deviceId
        return rpcClient.call("viber.messages.monitor.start", json.encodeToString(request), queueName = authQueue(targetDevice))
    }

    suspend fun stopMonitor(deviceId: String? = null): String {
        return rpcClient.call("viber.messages.monitor.stop", queueName = authQueue(deviceId))
    }

    suspend fun getMonitorStatus(deviceId: String? = null): String {
        return rpcClient.call("viber.messages.monitor.status", queueName = authQueue(deviceId))
    }

    suspend fun getMonitoredGroups(deviceId: String? = null): String {
        return rpcClient.call("viber.messages.monitor.groups", queueName = authQueue(deviceId))
    }

    suspend fun findConversationIdByGroupKey(groupKey: String, deviceId: String? = null): Int? {
        val groups = json.decodeFromString<List<GroupSummary>>(getGroups(includeAll = true, deviceId = deviceId))
        return groups.firstOrNull { it.groupId == groupKey }?.id
            ?: groups.firstOrNull { it.groupId.isNullOrBlank() && it.id.toString() == groupKey }?.id
    }

    suspend fun enableMonitorGroup(id: Int, request: EnableMonitorGroupRequest, deviceId: String? = null): String {
        val targetDevice = request.deviceId ?: deviceId
        val payload = buildJsonObject {
            put("id", id)
            put("dto", json.encodeToJsonElement(request))
        }
        return rpcClient.call(
            "viber.messages.monitor.enable_group",
            payload,
            queueName = authQueue(targetDevice)
        )
    }

    suspend fun disableMonitorGroup(id: Int, deviceId: String? = null): String {
        return rpcClient.call(
            "viber.messages.monitor.disable_group",
            mapOf("id" to id),
            queueName = authQueue(deviceId)
        )
    }

    suspend fun getMonitoredMessages(queryParams: Map<String, String>, deviceId: String? = null): String {
        return rpcClient.call("viber.messages.get_monitored", queryParams, queueName = authQueue(deviceId))
    }

    override suspend fun enterPhoneNumber(request: LoginRequest): LoginResponse {
        val raw = rpcClient.call("viber.auth.phone", json.encodeToString(request), authQueue(request.deviceId))
        return json.decodeFromString(raw)
    }

    override suspend fun enterCode(request: CodeRequest): LoginResponse {
        val raw = rpcClient.call("viber.auth.code", json.encodeToString(request), authQueue(request.deviceId))
        return json.decodeFromString(raw)
    }

    override suspend fun requestCall(request: CallRequest): LoginResponse {
        val raw = rpcClient.call("viber.auth.call", queueName = authQueue(request.deviceId))
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


    suspend fun getBroadcastStatus(deviceId: String? = null): String {
        return rpcClient.call("viber.broadcast.status", queueName = authQueue(deviceId))
    }

    suspend fun getBroadcastHistory(
        conversationId: Int? = null,
        campaignId: String? = null,
        limit: Int? = null,
        deviceId: String? = null,
    ): String {
        val payload = buildJsonObject {
            conversationId?.let { put("conversationId", it) }
            campaignId?.let { put("campaignId", it) }
            limit?.let { put("limit", it) }
        }
        return rpcClient.call("viber.broadcast.history", payload, queueName = authQueue(deviceId))
    }

    suspend fun getBroadcastLastSends(deviceId: String? = null): String {
        return rpcClient.call("viber.broadcast.history.last", queueName = authQueue(deviceId))
    }

    suspend fun listCampaigns(deviceId: String? = null): String {
        return rpcClient.call("viber.broadcast.campaigns.list", queueName = authQueue(deviceId))
    }

    suspend fun getCampaign(id: String, deviceId: String? = null): String {
        return rpcClient.call("viber.broadcast.campaigns.get", mapOf("id" to id), queueName = authQueue(deviceId))
    }

    suspend fun createCampaign(request: CreateCampaignRequest, deviceId: String? = null): String {
        return rpcClient.call(
            "viber.broadcast.campaigns.create",
            sparseJson.encodeToString(request),
            queueName = authQueue(deviceId),
        )
    }

    suspend fun updateCampaign(id: String, request: UpdateCampaignRequest, deviceId: String? = null): String {
        val changes = sparseJson.encodeToJsonElement(request) as JsonObject
        val payload = JsonObject(changes + ("id" to JsonPrimitive(id)))
        return rpcClient.call("viber.broadcast.campaigns.update", payload, queueName = authQueue(deviceId))
    }

    suspend fun deleteCampaign(id: String, deviceId: String? = null): String {
        return rpcClient.call("viber.broadcast.campaigns.delete", mapOf("id" to id), queueName = authQueue(deviceId))
    }

    suspend fun startCampaign(id: String, deviceId: String? = null): String {
        return rpcClient.call("viber.broadcast.campaigns.start", mapOf("id" to id), queueName = authQueue(deviceId))
    }

    suspend fun stopCampaign(id: String, deviceId: String? = null): String {
        return rpcClient.call("viber.broadcast.campaigns.stop", mapOf("id" to id), queueName = authQueue(deviceId))
    }

}
