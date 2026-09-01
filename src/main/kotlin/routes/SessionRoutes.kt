package com.viber.routes

import com.viber.appium.AppiumManager
import com.viber.appium.ParserState
import com.viber.dto.ScrollMembersRequest
import com.viber.dto.StatusResponse
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.application
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.get
import io.ktor.server.routing.post
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import org.slf4j.LoggerFactory

private val logger = LoggerFactory.getLogger("com.viber.routes.SessionRoutes")

/**
 * Управление Appium-сессией: запуск, состояние, прокрутка участников, остановка.
 *
 * Эти маршруты — **fire-and-forget**: `/start` и `/scroll-members` поднимают корутину на
 * [Dispatchers.IO], отвечают `202` сразу и падения только логируют. В HTTP-ответ ошибка
 * автоматизации не попадает никогда — за ходом дела клиент следит через `/status` и
 * машину состояний [ParserState]. Тем и отличаются от маршрутов к базе устройства,
 * которые отвечают синхронно (см. [com.viber.routes.groupRoutes]).
 *
 * Переходы стережёт сам маршрут, сверяясь с `AppiumManager.currentState` до действия.
 */
fun Route.sessionRoutes() {

    post("/start") {
        if (AppiumManager.currentState == ParserState.INITIALIZING ||
            AppiumManager.currentState == ParserState.RUNNING
        ) {
            call.respond(HttpStatusCode.Conflict, mapOf("error" to "Parser already started"))
            return@post
        }

        call.application.launch(Dispatchers.IO) {
            try {
                AppiumManager.startSession()
            } catch (e: Exception) {
                logger.error("Error during starting session", e)
            }
        }
        call.respond(HttpStatusCode.Accepted, mapOf("message" to "Processing started"))
    }

    get("/status") {
        call.respond(
            HttpStatusCode.OK,
            StatusResponse(
                state = AppiumManager.currentState.name,
                isDriverActive = AppiumManager.driver != null,
            ),
        )
    }

    post("/scroll-members") {
        if (AppiumManager.currentState != ParserState.RUNNING) {
            call.respond(
                HttpStatusCode.BadRequest,
                mapOf("error" to "Session is not running, current state: ${AppiumManager.currentState.name}"),
            )
            return@post
        }

        val request = try {
            call.receive<ScrollMembersRequest>()
        } catch (e: Exception) {
            call.respond(HttpStatusCode.BadRequest, mapOf("error" to "Request is not valid"))
            return@post
        }

        call.application.launch(Dispatchers.IO) {
            try {
                AppiumManager.scrollMembers(request.groupName)
            } catch (e: Exception) {
                logger.error("Error during scroll members", e)
            }
        }
        call.respond(HttpStatusCode.Accepted, mapOf("message" to "Scrolling started"))
    }

    post("/stop") {
        if (AppiumManager.currentState == ParserState.IDLE) {
            call.respond(HttpStatusCode.BadRequest, mapOf("message" to "Parsing stopped"))
            return@post
        }
        try {
            AppiumManager.stopSession()
            call.respond(HttpStatusCode.Accepted, mapOf("message" to "Appium is stopped"))
        } catch (e: Exception) {
            logger.error("Error during stopping session", e)
            call.respond(HttpStatusCode.BadRequest, mapOf("error" to "Error during stopping session"))
        }
    }
}
