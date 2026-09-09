package com.viber.routes

import com.viber.clients.ViberBotClient
import com.viber.models.DecodeRequest
import com.viber.routes.docs.describeDecodeParticipants
import com.viber.routes.docs.describeGetDatabaseStats
import com.viber.routes.docs.describeSyncDatabase
import io.github.smiley4.ktoropenapi.get
import io.github.smiley4.ktoropenapi.post
import io.ktor.http.ContentType
import io.ktor.server.request.receiveNullable
import io.ktor.server.response.respondText
import io.ktor.server.routing.Route
import io.ktor.server.routing.route

fun Route.databaseRoutes(viberBotClient: ViberBotClient) {
    route("/database") {
        post("/sync", describeSyncDatabase){
            call.respondText(viberBotClient.syncDatabase(), ContentType.Application.Json)
        }

        get("/stats", describeGetDatabaseStats){
            call.respondText(viberBotClient.getDatabaseStats(), ContentType.Application.Json)
        }

        post("/decode", describeDecodeParticipants){
            val request = call.receiveNullable<DecodeRequest>() ?: DecodeRequest()
            call.respondText(viberBotClient.decodeParticipants(request = request), ContentType.Application.Json)
        }
    }
}