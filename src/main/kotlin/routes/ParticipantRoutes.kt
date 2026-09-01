package com.viber.routes

import com.viber.appium.AppiumManager
import com.viber.appium.ParserState
import com.viber.device.DeviceDatabase
import com.viber.device.ParticipantDecoder
import com.viber.dto.DecodeParticipantsRequest
import com.viber.dto.ErrorResponse
import com.viber.dto.toDecodeOptions
import com.viber.dto.toResponse
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.ApplicationCall
import io.ktor.server.request.contentLength
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.post

/**
 * `POST /api/participants/decode` — разбор конвертов `encrypted_member_id` и правка
 * карточек в `participants_info`.
 *
 * Единственный маршрут, который **пишет** в базу устройства, поэтому отвечает синхронно
 * и подробно: клиенту нужно видеть не только «принято», но и что именно изменилось.
 * Источники приходят параметрами — с фейковыми [ParticipantDecoder] и состоянием сессии
 * маршрут проверяется без устройства.
 */
fun Route.participantRoutes(
    decoder: () -> ParticipantDecoder = { DeviceDatabase.participants },
    sessionState: () -> ParserState = { AppiumManager.currentState },
) {

    post("/participants/decode") {
        val request = call.decodeRequest() ?: return@post

        request.limit?.let { limit ->
            if (limit <= 0) {
                call.respond(HttpStatusCode.BadRequest, ErrorResponse("limit must be a positive number, got $limit"))
                return@post
            }
        }

        // Запись гасит Viber — под живой Appium-сессией это выдернуло бы приложение
        // из-под автоматизации. Сухой прогон ничего не трогает и разрешён всегда.
        if (!request.dryRun && sessionState() in BUSY_STATES) {
            call.respond(
                HttpStatusCode.Conflict,
                ErrorResponse("Appium session is ${sessionState().name} — stop it first or ask for a dry run"),
            )
            return@post
        }

        onDevice { decoder().decode(request.toDecodeOptions()) }
            .onSuccess { call.respond(HttpStatusCode.OK, it.toResponse()) }
            .onFailure { call.respondDeviceFailure(it) }
    }
}

private val BUSY_STATES = setOf(ParserState.INITIALIZING, ParserState.RUNNING)

/**
 * Тело необязательно: `POST` без него значит «на дефолтах». А вот присланное и
 * непрочитанное тело — это 400, иначе опечатка в опции молча превратилась бы в правку
 * всей базы.
 *
 * @return null, если ответ уже отправлен.
 */
private suspend fun ApplicationCall.decodeRequest(): DecodeParticipantsRequest? {
    if ((request.contentLength() ?: 0L) == 0L) return DecodeParticipantsRequest()

    return try {
        receive<DecodeParticipantsRequest>()
    } catch (e: Exception) {
        respond(HttpStatusCode.BadRequest, ErrorResponse("Request is not valid: ${e.message?.take(200)}"))
        null
    }
}
