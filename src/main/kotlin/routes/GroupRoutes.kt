package com.viber.routes

import com.viber.clients.ViberBotClient
import com.viber.routes.docs.describeGetGroup
import com.viber.routes.docs.describeGetGroupParticipants
import com.viber.routes.docs.describeGetGroups
import io.ktor.server.routing.Route
import io.ktor.server.routing.route
import io.github.smiley4.ktoropenapi.get
import io.ktor.http.ContentType
import io.ktor.server.response.respondText


fun Route.groupRoutes(viberBotClient: ViberBotClient){
    route("/groups"){
        get("", describeGetGroups){
            val includeAll = call.request.queryParameters["all"]?.let { it == "true" || it == "1"} ?: false
            call.respondText(viberBotClient.getGroups(includeAll), ContentType.Application.Json)
        }

        get("/{id}", describeGetGroup) {
            val id = call.parameters["id"]!!.toInt()
            call.respondText(viberBotClient.getGroup(id), ContentType.Application.Json)
        }

        get("/{id}/participants", describeGetGroupParticipants) {
            val id = call.parameters["id"]!!.toInt()
            call.respondText(viberBotClient.getGroupParticipants(id), ContentType.Application.Json)
        }
    }

}