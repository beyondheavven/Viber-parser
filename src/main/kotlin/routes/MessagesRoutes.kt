package com.viber.routes

import com.viber.bot.ViberBotClient
import com.viber.models.EnableMonitorGroupRequest
import com.viber.models.StartMonitorRequest
import com.viber.routes.docs.describeDisableMonitorGroup
import com.viber.routes.docs.describeEnableMonitorGroup
import com.viber.routes.docs.describeExportMonitoredMessages
import com.viber.routes.docs.describeGetMonitoredGroups
import com.viber.routes.docs.describeGetMonitoredMessages
import com.viber.routes.docs.describeGetMonitorStatus
import com.viber.routes.docs.describeStartMonitor
import com.viber.routes.docs.describeStopMonitor
import com.viber.services.MonitoredMessageQueryService
import io.github.smiley4.ktoropenapi.get
import io.github.smiley4.ktoropenapi.post
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.server.plugins.NotFoundException
import io.ktor.server.request.receiveNullable
import io.ktor.server.response.header
import io.ktor.server.response.respondText
import io.ktor.server.routing.Route
import io.ktor.server.routing.route
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

fun Route.messageRoutes(
    viberBotClient: ViberBotClient,
    queryService: MonitoredMessageQueryService? = null,
) {
    route("/messages") {
        get("/monitored", describeGetMonitoredMessages) {
            val deviceId = call.request.queryParameters["deviceId"]
            val conversationId = call.request.queryParameters["conversationId"]?.toIntOrNull()
            val hasPhone = call.request.queryParameters["hasPhone"]?.toBooleanStrictOrNull()
            val phoneSource = call.request.queryParameters["phoneSource"]
            val limit = call.request.queryParameters["limit"]?.toIntOrNull() ?: 2000
            val offset = call.request.queryParameters["offset"]?.toIntOrNull() ?: 0

            val messages = queryService?.listMessages(
                deviceId = deviceId,
                conversationId = conversationId,
                hasPhone = hasPhone,
                phoneSource = phoneSource,
                limit = limit,
                offset = offset,
            ) ?: emptyList()

            call.respondText(json.encodeToString(messages), ContentType.Application.Json)
        }

        get("/monitored/export", describeExportMonitoredMessages) {
            val format = call.request.queryParameters["format"] ?: "csv"
            val deviceId = call.request.queryParameters["deviceId"]
            val conversationId = call.request.queryParameters["conversationId"]?.toIntOrNull()
            val hasPhone = call.request.queryParameters["hasPhone"]?.toBooleanStrictOrNull()
            val phoneSource = call.request.queryParameters["phoneSource"]
            val limit = call.request.queryParameters["limit"]?.toIntOrNull() ?: 0

            val result = queryService?.exportMessages(
                format = format,
                deviceId = deviceId,
                conversationId = conversationId,
                hasPhone = hasPhone,
                phoneSource = phoneSource,
                limit = limit,
            )

            if (result != null) {
                call.response.header(
                    HttpHeaders.ContentDisposition,
                    "attachment; filename=\"${result.filename}\"",
                )
                call.respondText(result.content, ContentType.parse(result.contentType))
            } else {
                call.respondText("[]", ContentType.Application.Json)
            }
        }

        route("/monitor") {
            post("/start", describeStartMonitor) {
                val request = call.receiveNullable<StartMonitorRequest>() ?: StartMonitorRequest()
                val deviceId = request.deviceId ?: call.request.queryParameters["deviceId"]
                call.respondText(viberBotClient.startMonitor(request, deviceId), ContentType.Application.Json)
            }

            post("/stop", describeStopMonitor) {
                val deviceId = call.request.queryParameters["deviceId"]
                call.respondText(viberBotClient.stopMonitor(deviceId), ContentType.Application.Json)
            }

            get("/status", describeGetMonitorStatus) {
                val deviceId = call.request.queryParameters["deviceId"]
                call.respondText(viberBotClient.getMonitorStatus(deviceId), ContentType.Application.Json)
            }

            get("/groups", describeGetMonitoredGroups) {
                val deviceId = call.request.queryParameters["deviceId"]
                call.respondText(viberBotClient.getMonitoredGroups(deviceId), ContentType.Application.Json)
            }

            post("/groups/{id}/enable", describeEnableMonitorGroup) {
                val request = call.receiveNullable<EnableMonitorGroupRequest>() ?: EnableMonitorGroupRequest()
                val deviceId = request.deviceId ?: call.request.queryParameters["deviceId"]
                val groupKey = request.groupKey?.trim()?.takeIf { it.isNotEmpty() }
                val id = if (groupKey == null) {
                    call.parameters["id"]!!.toInt()
                } else {
                    viberBotClient.findConversationIdByGroupKey(groupKey, deviceId)
                        ?: throw NotFoundException("Группа с groupKey $groupKey не найдена на этом эмуляторе")
                }
                call.respondText(viberBotClient.enableMonitorGroup(id, request, deviceId), ContentType.Application.Json)
            }

            post("/groups/{id}/disable", describeDisableMonitorGroup) {
                val id = call.parameters["id"]!!.toInt()
                val deviceId = call.request.queryParameters["deviceId"]
                call.respondText(viberBotClient.disableMonitorGroup(id, deviceId), ContentType.Application.Json)
            }
        }
    }
}