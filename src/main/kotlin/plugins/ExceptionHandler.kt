package com.viber.plugins

import com.viber.clients.MicroserviceException
import com.viber.models.ErrorResponse
import com.viber.models.ErrorType
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.Application
import io.ktor.server.application.install
import io.ktor.server.plugins.statuspages.StatusPages
import io.ktor.server.request.path
import io.ktor.server.request.uri
import io.ktor.server.response.respond
import kotlinx.coroutines.TimeoutCancellationException
import java.time.Instant


fun Application.configureException() {
    install(StatusPages) {
        exception<MicroserviceException> { call, cause ->
            val type = when (cause.statusCode) {
                HttpStatusCode.Conflict -> ErrorType.DEVICE_BUSY
                HttpStatusCode.NotFound -> ErrorType.NOT_FOUND
                HttpStatusCode.BadRequest -> ErrorType.VALIDATION_ERROR
                else -> ErrorType.BOT_ERROR
            }

            call.respond(
                cause.statusCode,
                ErrorResponse(
                    success = false,
                    errorType = type,
                    message = cause.message ?: "Ошибка внутри бота",
                    path = call.request.path(),
                    timestamp = Instant.now().toString()
                )
            )
        }

        exception<TimeoutCancellationException> { call, cause ->
            call.respond(
                HttpStatusCode.GatewayTimeout,
                ErrorResponse(
                    success = false,
                    errorType = ErrorType.RPC_TIMEOUT,
                    message = cause.message ?: "Бот не ответил за отведенное время. Возможно, он занят или завис Appium.",
                    path = call.request.path(),
                    timestamp = Instant.now().toString()
                )
            )
        }

        exception<Throwable> { call, cause ->
            call.respond(
                HttpStatusCode.InternalServerError,
                ErrorResponse(
                    success = false,
                    errorType = ErrorType.API_INTERNAL_ERROR,
                    message = cause.message ?: "Внутренняя ошибка сервера API",
                    path = call.request.uri,
                    timestamp = Instant.now().toString()
                )
            )

        }
    }
}
