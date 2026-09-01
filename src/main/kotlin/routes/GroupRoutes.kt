package com.viber.routes

import com.viber.device.DeviceDatabase
import com.viber.device.ViberDatabase
import com.viber.dto.ErrorResponse
import com.viber.dto.toGroupsResponse
import com.viber.dto.toMembersResponse
import io.ktor.http.HttpStatusCode
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.get

/**
 * Чтение базы Viber на устройстве: группы и их участники.
 *
 * В отличие от `/api/start` и `/api/scroll-members` эти маршруты отвечают синхронно —
 * запрос к базе это один короткий запуск adb, а не многоминутная автоматизация UI, и
 * Appium-сессия им не нужна. Источник данных приходит параметром: подставив фейковый
 * [ViberDatabase], маршруты можно проверять без устройства.
 */
fun Route.groupRoutes(database: () -> ViberDatabase = { DeviceDatabase.viber }) {

    get("/groups") {
        onDevice { database().groups().toGroupsResponse() }
            .onSuccess { call.respond(HttpStatusCode.OK, it) }
            .onFailure { call.respondDeviceFailure(it) }
    }

    get("/groups/{id}/members") {
        val conversationId = call.parameters["id"]?.toLongOrNull()
        if (conversationId == null) {
            call.respond(HttpStatusCode.BadRequest, ErrorResponse("Group id must be a number"))
            return@get
        }
        val includeInactive = call.request.queryParameters["includeInactive"].toBoolean()

        onDevice {
            val database = database()
            // Группу ищем отдельно: иначе «нет такой группы» неотличимо от «группа пустая».
            database.group(conversationId)
                ?.toMembersResponse(database.members(conversationId, includeInactive))
        }
            .onSuccess { members ->
                if (members == null) {
                    call.respond(
                        HttpStatusCode.NotFound,
                        ErrorResponse("No group with conversation id $conversationId"),
                    )
                } else {
                    call.respond(HttpStatusCode.OK, members)
                }
            }
            .onFailure { call.respondDeviceFailure(it) }
    }
}
