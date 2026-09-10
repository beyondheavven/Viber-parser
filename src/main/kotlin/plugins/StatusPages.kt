package com.viber.plugins

import com.viber.clients.MicroserviceException
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.Application
import io.ktor.server.application.install
import io.ktor.server.plugins.statuspages.StatusPages
import io.ktor.server.response.respond

fun Application.configureStatusPages() {
    install(StatusPages) {
        exception<MicroserviceException> { call, cause ->
            call.respond(cause.statusCode, mapOf(
                "success" to false,
                "message" to cause.message
            ))
        }
        exception<Throwable> { call, cause ->
            call.respond(HttpStatusCode.InternalServerError, mapOf(
                "success" to false,
                "message" to (cause.message ?: "Internal server error")
            ))
        }
    }
}
