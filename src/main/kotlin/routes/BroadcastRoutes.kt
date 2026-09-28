package com.viber.routes

import com.viber.bot.DeviceQueueRouting
import com.viber.bot.ViberBotClient
import com.viber.models.CreateCampaignRequest
import com.viber.models.UpdateCampaignRequest
import com.viber.routes.docs.describeBroadcastHistory
import com.viber.routes.docs.describeBroadcastLastSends
import com.viber.routes.docs.describeBroadcastStatus
import com.viber.routes.docs.describeCreateCampaign
import com.viber.routes.docs.describeDeleteCampaign
import com.viber.routes.docs.describeGetCampaign
import com.viber.routes.docs.describeListCampaigns
import com.viber.routes.docs.describeStartCampaign
import com.viber.routes.docs.describeStopCampaign
import com.viber.routes.docs.describeUpdateCampaign
import io.github.smiley4.ktoropenapi.delete
import io.github.smiley4.ktoropenapi.get
import io.github.smiley4.ktoropenapi.patch
import io.github.smiley4.ktoropenapi.post
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.server.request.receive
import io.ktor.server.plugins.BadRequestException
import io.ktor.server.response.respondText
import io.ktor.server.routing.Route
import io.ktor.server.routing.route

fun Route.broadcastRoutes(viberBotClient: ViberBotClient) {
    route("/broadcast") {
        get("/status", describeBroadcastStatus) {
            val deviceId = validatedBroadcastDeviceId(call.request.queryParameters["deviceId"])
            call.respondText(viberBotClient.getBroadcastStatus(deviceId), ContentType.Application.Json)
        }

        get("/history/last", describeBroadcastLastSends) {
            val deviceId = validatedBroadcastDeviceId(call.request.queryParameters["deviceId"])
            call.respondText(viberBotClient.getBroadcastLastSends(deviceId), ContentType.Application.Json)
        }

        get("/history", describeBroadcastHistory) {
            val deviceId = validatedBroadcastDeviceId(call.request.queryParameters["deviceId"])
            val conversationId = call.request.queryParameters["conversationId"]?.toIntOrNull()
            val campaignId = call.request.queryParameters["campaignId"]
            val limit = call.request.queryParameters["limit"]?.toIntOrNull()
            call.respondText(
                viberBotClient.getBroadcastHistory(conversationId, campaignId, limit, deviceId),
                ContentType.Application.Json,
            )
        }

        route("/campaigns") {
            get("", describeListCampaigns) {
                val deviceId = validatedBroadcastDeviceId(call.request.queryParameters["deviceId"])
                call.respondText(viberBotClient.listCampaigns(deviceId), ContentType.Application.Json)
            }

            post("", describeCreateCampaign) {
                val deviceId = validatedBroadcastDeviceId(call.request.queryParameters["deviceId"])
                val request = call.receive<CreateCampaignRequest>()
                call.respondText(
                    viberBotClient.createCampaign(request, deviceId),
                    ContentType.Application.Json,
                    HttpStatusCode.Created,
                )
            }

            get("/{id}", describeGetCampaign) {
                val deviceId = validatedBroadcastDeviceId(call.request.queryParameters["deviceId"])
                val id = call.requireCampaignId()
                call.respondText(viberBotClient.getCampaign(id, deviceId), ContentType.Application.Json)
            }

            patch("/{id}", describeUpdateCampaign) {
                val deviceId = validatedBroadcastDeviceId(call.request.queryParameters["deviceId"])
                val id = call.requireCampaignId()
                val request = call.receive<UpdateCampaignRequest>()
                call.respondText(
                    viberBotClient.updateCampaign(id, request, deviceId),
                    ContentType.Application.Json,
                )
            }

            delete("/{id}", describeDeleteCampaign) {
                val deviceId = validatedBroadcastDeviceId(call.request.queryParameters["deviceId"])
                val id = call.requireCampaignId()
                call.respondText(viberBotClient.deleteCampaign(id, deviceId), ContentType.Application.Json)
            }

            post("/{id}/start", describeStartCampaign) {
                val deviceId = validatedBroadcastDeviceId(call.request.queryParameters["deviceId"])
                val id = call.requireCampaignId()
                call.respondText(viberBotClient.startCampaign(id, deviceId), ContentType.Application.Json)
            }

            post("/{id}/stop", describeStopCampaign) {
                val deviceId = validatedBroadcastDeviceId(call.request.queryParameters["deviceId"])
                val id = call.requireCampaignId()
                call.respondText(viberBotClient.stopCampaign(id, deviceId), ContentType.Application.Json)
            }
        }
    }
}

private fun io.ktor.server.application.ApplicationCall.requireCampaignId(): String =
    parameters["id"] ?: throw IllegalArgumentException("Не указан ID кампании")

private fun validatedBroadcastDeviceId(deviceId: String?): String? {
    try {
        DeviceQueueRouting.queueName(deviceId)
    } catch (error: IllegalArgumentException) {
        throw BadRequestException(error.message ?: "Invalid deviceId", error)
    }
    return deviceId
}
