package com.viber.routes

import com.viber.clients.AutomationClient
import com.viber.models.CollectParticipantsRequest
import com.viber.models.QueryOnlineStatusRequest
import com.viber.routes.docs.describeCollectParticipants
import com.viber.routes.docs.describeGetOnlineStatuses
import io.ktor.server.routing.Route
import io.github.smiley4.ktoropenapi.post
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.response.respondText
import io.ktor.server.routing.route


fun Route.participantsRoutes(automationClient: AutomationClient){
    route("/participants") {
        post("/collect", describeCollectParticipants){
            val request = call.receive<CollectParticipantsRequest>()
            val result = automationClient.collectParticipants(request)
            call.respond(HttpStatusCode.Accepted, result)
        }

        post("/online-status", describeGetOnlineStatuses){
            val request = call.receive<QueryOnlineStatusRequest>()
            call.respondText(
                automationClient.getOnlineStatuses(request),
                ContentType.Application.Json
            )
        }
    }

}