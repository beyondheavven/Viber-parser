package com.viber.plugins

import com.viber.routes.groupRoutes
import com.viber.routes.parserRoutes
import io.github.smiley4.ktoropenapi.openApi
import io.github.smiley4.ktorswaggerui.swaggerUI
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.Application
import io.ktor.server.response.respondText
import io.ktor.server.routing.get
import io.ktor.server.routing.route
import io.ktor.server.routing.routing

fun Application.configureRouting() {
    routing {
        route("api.json"){
            openApi()
        }

        route("swagger"){
            swaggerUI("/api.json")
        }

        route("/api"){
            parserRoutes()
            groupRoutes()
        }
    }
}