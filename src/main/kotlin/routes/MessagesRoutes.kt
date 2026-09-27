package com.viber.routes

import com.viber.bot.ViberBotClient
import com.viber.models.EnableMonitorGroupRequest
import com.viber.models.StartMonitorRequest
import com.viber.routes.docs.describeDisableMonitorGroup
import com.viber.routes.docs.describeEnableMonitorGroup
import com.viber.routes.docs.describeGetMonitoredGroups
import com.viber.routes.docs.describeGetMonitorStatus
import com.viber.routes.docs.describeStartMonitor
import com.viber.routes.docs.describeStopMonitor
import io.github.smiley4.ktoropenapi.post
import io.github.smiley4.ktoropenapi.get
import io.ktor.http.ContentType
import io.ktor.server.plugins.NotFoundException
import io.ktor.server.request.receiveNullable
import io.ktor.server.response.respondText
import io.ktor.server.routing.Route
import io.ktor.server.routing.route

fun Route.messageRoutes(viberBotClient: ViberBotClient) {
    route("/messages/monitor"){
        post("/start", describeStartMonitor){
            val request = call.receiveNullable<StartMonitorRequest>() ?: StartMonitorRequest()
            call.respondText(viberBotClient.startMonitor(request), ContentType.Application.Json)
        }

        post("/stop", describeStopMonitor){
            call.respondText(viberBotClient.stopMonitor(), ContentType.Application.Json)
        }

        get("/status", describeGetMonitorStatus){
            call.respondText(viberBotClient.getMonitorStatus(), ContentType.Application.Json)
        }

        get("/groups", describeGetMonitoredGroups){
            call.respondText(viberBotClient.getMonitoredGroups(), ContentType.Application.Json)
        }

        post("/groups/{id}/enable", describeEnableMonitorGroup){
            val request = call.receiveNullable<EnableMonitorGroupRequest>() ?: EnableMonitorGroupRequest()
            val groupKey = request.groupKey?.trim()?.takeIf { it.isNotEmpty() }
            val id = if (groupKey == null) {
                call.parameters["id"]!!.toInt()
            } else {
                viberBotClient.findConversationIdByGroupKey(groupKey)
                    ?: throw NotFoundException("Группа с groupKey $groupKey не найдена на этом эмуляторе")
            }
            call.respondText(viberBotClient.enableMonitorGroup(id, request), ContentType.Application.Json)
        }

        post("/groups/{id}/disable", describeDisableMonitorGroup){
            val id = call.parameters["id"]!!.toInt()
            call.respondText(viberBotClient.disableMonitorGroup(id), ContentType.Application.Json)
        }
    }

}