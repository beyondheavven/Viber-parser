package com.viber.routes

import com.viber.bot.DeviceQueueRouting
import com.viber.bot.ViberBotClient
import com.viber.routes.docs.describeGetAllTasks
import com.viber.routes.docs.describeGetTaskDetail
import com.viber.routes.docs.describeGetTaskParticipants
import com.viber.routes.docs.describeStopTask
import io.github.smiley4.ktoropenapi.get
import io.github.smiley4.ktoropenapi.post
import io.ktor.http.ContentType
import io.ktor.server.plugins.BadRequestException
import io.ktor.server.response.respondText
import io.ktor.server.routing.Route
import io.ktor.server.routing.route


private fun validatedDeviceId(deviceId: String?): String? {
    try {
        DeviceQueueRouting.queueName(deviceId)
    } catch (error: IllegalArgumentException) {
        throw BadRequestException(error.message ?: "Invalid deviceId", error)
    }
    return deviceId
}

fun Route.tasksRoutes(viberBotClient: ViberBotClient) {
    route("/tasks"){
        get("", describeGetAllTasks){
            val status = call.request.queryParameters["status"]
            val deviceId = validatedDeviceId(call.request.queryParameters["deviceId"])
            call.respondText(viberBotClient.getTasks(status, deviceId), ContentType.Application.Json)
        }

        get("/{id}", describeGetTaskDetail) {
            val id = call.parameters["id"]!!
            val deviceId = validatedDeviceId(call.request.queryParameters["deviceId"])
            call.respondText(viberBotClient.getTask(id, deviceId), ContentType.Application.Json)
        }

        get("/{id}/participants", describeGetTaskParticipants) {
            val id = call.parameters["id"]!!
            val deviceId = validatedDeviceId(call.request.queryParameters["deviceId"])
            call.respondText(viberBotClient.getTaskParticipants(id, deviceId), ContentType.Application.Json)
        }

        post("/{id}/stop", describeStopTask){
            val id = call.parameters["id"]!!
            val deviceId = validatedDeviceId(call.request.queryParameters["deviceId"])
            call.respondText(viberBotClient.stopTask(id, deviceId), ContentType.Application.Json)
        }
    }

}
