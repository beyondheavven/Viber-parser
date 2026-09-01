package com.viber.routes

import io.ktor.http.HttpStatusCode
import io.ktor.server.application.Application
import io.ktor.server.response.respondText
import io.ktor.server.routing.route
import io.ktor.server.routing.routing
import io.ktor.server.routing.get

/**
 * Таблица маршрутов — и больше ничего.
 *
 * Обработчики живут в соседних файлах по смыслу того, с чем работают: сессия Appium,
 * чтение базы устройства, правка карточек участников. Здесь видно только, что у API
 * вообще есть.
 */
fun Application.configureRouting() {
    routing {
        get("/health") {
            call.respondText("Parser started", status = HttpStatusCode.OK)
        }

        route("/api") {
            // Управление Appium-сессией: fire-and-forget, ответ 202.
            sessionRoutes()
            // Чтение базы устройства: группы, которые вообще есть в Viber.
            groupRoutes()
            // Единственный путь на запись: правка карточек в participants_info.
            participantRoutes()
        }
    }
}
