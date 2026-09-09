package com.viber.routes

import com.viber.clients.ViberBotClient
import com.viber.routes.docs.describeGetAllTasks
import com.viber.routes.docs.describeGetTaskDetail
import com.viber.routes.docs.describeGetTaskParticipants
import com.viber.routes.docs.describeStopTask
import io.github.smiley4.ktoropenapi.get
import io.github.smiley4.ktoropenapi.post
import io.ktor.http.ContentType
import io.ktor.server.response.respondText
import io.ktor.server.routing.Route
import io.ktor.server.routing.route


fun Route.tasksRoutes(viberBotClient: ViberBotClient) {
    route("/tasks"){
        get("", describeGetAllTasks){
            val status = call.request.queryParameters["status"]
            call.respondText(viberBotClient.getTasks(status), ContentType.Application.Json)
        }

        get("/{id}", describeGetTaskDetail) {
            val id = call.parameters["id"]!!
            call.respondText(viberBotClient.getTask(id), ContentType.Application.Json)
        }

        get("/{id}/participants", describeGetTaskParticipants) {
            val id = call.parameters["id"]!!
            call.respondText(viberBotClient.getTaskParticipants(id), ContentType.Application.Json)
        }

        post("/{id}/stop", describeStopTask){
            val id = call.parameters["id"]!!
            call.respondText(viberBotClient.stopTask(id), ContentType.Application.Json)
        }
    }

}