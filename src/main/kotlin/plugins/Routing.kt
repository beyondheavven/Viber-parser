package com.viber.plugins

import io.ktor.http.HttpStatusCode
import io.ktor.server.application.*
import io.ktor.server.response.*
import io.ktor.server.routing.*

fun Application.configureRouting() {
    routing {
        get("/health") {
            call.respondText("Parser started", status = HttpStatusCode.OK)
        }

        route("/api"){
            post("/start"){
                call.respondText("Launching LDPlayer...", status = HttpStatusCode.OK)
            }
        }
    }
}