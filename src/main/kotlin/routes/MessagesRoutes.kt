package com.viber.routes

import com.viber.clients.AutomationClient
import com.viber.models.EnableMonitorGroupRequest
import com.viber.models.StartMonitorRequest
import com.viber.routes.docs.describeDisableMonitorGroup
import com.viber.routes.docs.describeEnableMonitorGroup
import com.viber.routes.docs.describeGetMonitorStatus
import com.viber.routes.docs.describeStartMonitor
import com.viber.routes.docs.describeStopMonitor
import io.github.smiley4.ktoropenapi.post
import io.github.smiley4.ktoropenapi.get
import io.ktor.http.ContentType
import io.ktor.server.request.receiveNullable
import io.ktor.server.response.respondText
import io.ktor.server.routing.Route
import io.ktor.server.routing.route

fun Route.messageRoutes(automationClient: AutomationClient) {
    route("/messages/monitor"){
        post("/start", describeStartMonitor){
            val request = call.receiveNullable<StartMonitorRequest>() ?: StartMonitorRequest()
            call.respondText(automationClient.startMonitor(request), ContentType.Application.Json)
        }

        post("/stop", describeStopMonitor){
            call.respondText(automationClient.stopMonitor(), ContentType.Application.Json)
        }

        get("/status", describeGetMonitorStatus){
            call.respondText(automationClient.getMonitorStatus(), ContentType.Application.Json)
        }

        get("/groups", describeEnableMonitorGroup){
            val id = call.parameters["id"]!!.toInt()
            val request = call.receiveNullable<EnableMonitorGroupRequest>() ?: EnableMonitorGroupRequest()
            call.respondText(automationClient.enableMonitorGroup(id, request), ContentType.Application.Json)
        }

        post("/groups/{id}/disable", describeDisableMonitorGroup){
            val id = call.parameters["id"]!!.toInt()
            call.respondText(automationClient.disableMonitorGroup(id), ContentType.Application.Json)
        }
    }

}