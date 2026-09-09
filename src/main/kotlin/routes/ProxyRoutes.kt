package com.viber.routes

import com.viber.clients.AutomationClient
import com.viber.models.CollectParticipantsRequest
import com.viber.models.QueryOnlineStatusRequest
import io.ktor.http.ContentType
import io.ktor.server.request.receive
import io.ktor.server.response.respondText
import io.ktor.server.routing.Route
import io.ktor.server.routing.post
import io.ktor.server.routing.route


fun Route.proxyRoutes(automationClient: AutomationClient) {

    route("/participants") {
        post("/collect"){
            val request = call.receive<CollectParticipantsRequest>()
            call.respond(automationClient.collectParticipants(request))
        }

        post("/online-status"){
            val request = call.receive<QueryOnlineStatusRequest>
            call.respondText(automationClient.getOnlineStatuses(request), ContentType.Application.Json)
        }

        rout
    }

}