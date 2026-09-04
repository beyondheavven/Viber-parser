package com.viber.routes

import io.github.smiley4.ktoropenapi.openApi
import io.github.smiley4.ktorswaggerui.swaggerUI
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.Application
import io.ktor.server.response.respondText
import io.ktor.server.routing.route
import io.ktor.server.routing.routing
import io.ktor.server.routing.get

fun Application.configureRouting() {
    routing {
        route("api.json") {
            openApi()
        }

        route("swagger") {
            swaggerUI("/api.json")
        }

        get("/health") {
            call.respondText("Parser started", status = HttpStatusCode.OK)
        }

        route("/api") {
            parserRoutes()
            groupRoutes()
            participantRoutes()
        }
    }
}
