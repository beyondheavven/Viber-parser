package com.viber.plugins

import com.viber.clients.MicroserviceException
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.Application
import io.ktor.server.application.install
import io.ktor.server.plugins.statuspages.StatusPages
import io.ktor.server.response.respond
import kotlinx.serialization.Serializable


@Serializable
data class ErrorResponse(
    val success: Boolean = false,
    val message: String,
)

fun Application.configureStatusPages() {
    install(StatusPages) {
        exception<MicroserviceException> { call, cause ->
            call.respond(cause.statusCode, ErrorResponse(message = cause.message ?: "Microservice call failed"))
        }
        exception<Throwable> { call, cause ->
            call.respond(
                HttpStatusCode.InternalServerError,
                ErrorResponse(message = cause.message ?: "Internal server error"),
            )
        }
    }
}
