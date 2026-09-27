package com.viber.routes

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
import io.ktor.server.response.respondText
import io.ktor.server.routing.Route
import io.ktor.server.routing.route

fun Route.broadcastRoutes(viberBotClient: ViberBotClient) {
    route("/broadcast") {
        get("/status", describeBroadcastStatus) {
            call.respondText(viberBotClient.getBroadcastStatus(), ContentType.Application.Json)
        }

        get("/history/last", describeBroadcastLastSends) {
            call.respondText(viberBotClient.getBroadcastLastSends(), ContentType.Application.Json)
        }

        get("/history", describeBroadcastHistory) {
            val conversationId = call.request.queryParameters["conversationId"]?.toIntOrNull()
            val campaignId = call.request.queryParameters["campaignId"]
            val limit = call.request.queryParameters["limit"]?.toIntOrNull()
            call.respondText(
                viberBotClient.getBroadcastHistory(conversationId, campaignId, limit),
                ContentType.Application.Json,
            )
        }

        route("/campaigns") {
            get("", describeListCampaigns) {
                call.respondText(viberBotClient.listCampaigns(), ContentType.Application.Json)
            }

            post("", describeCreateCampaign) {
                val request = call.receive<CreateCampaignRequest>()
                call.respondText(
                    viberBotClient.createCampaign(request),
                    ContentType.Application.Json,
                    HttpStatusCode.Created,
                )
            }

            get("/{id}", describeGetCampaign) {
                val id = call.requireCampaignId()
                call.respondText(viberBotClient.getCampaign(id), ContentType.Application.Json)
            }

            patch("/{id}", describeUpdateCampaign) {
                val id = call.requireCampaignId()
                val request = call.receive<UpdateCampaignRequest>()
                call.respondText(
                    viberBotClient.updateCampaign(id, request),
                    ContentType.Application.Json,
                )
            }

            delete("/{id}", describeDeleteCampaign) {
                val id = call.requireCampaignId()
                call.respondText(viberBotClient.deleteCampaign(id), ContentType.Application.Json)
            }

            post("/{id}/start", describeStartCampaign) {
                val id = call.requireCampaignId()
                call.respondText(viberBotClient.startCampaign(id), ContentType.Application.Json)
            }

            post("/{id}/stop", describeStopCampaign) {
                val id = call.requireCampaignId()
                call.respondText(viberBotClient.stopCampaign(id), ContentType.Application.Json)
            }
        }
    }
}

private fun io.ktor.server.application.ApplicationCall.requireCampaignId(): String =
    parameters["id"] ?: throw IllegalArgumentException("Не указан ID кампании")
