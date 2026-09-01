package com.viber.plugins

import com.viber.device.DeviceDatabase
import com.viber.device.ViberDatabase
import com.viber.dto.ErrorResponse
import com.viber.dto.toGroupsResponse
import com.viber.dto.toMembersResponse
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.ApplicationCall
import io.ktor.server.request.uri
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.get
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.slf4j.Logger
import org.slf4j.LoggerFactory

private val logger: Logger = LoggerFactory.getLogger("com.viber.plugins.GroupRoutes")

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
        readDevice { database().groups().toGroupsResponse() }
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

        readDevice {
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

/** Запуск adb блокирует поток — уводим с event loop, падение превращаем в результат. */
private suspend fun <T> readDevice(load: () -> T): Result<T> =
    try {
        Result.success(withContext(Dispatchers.IO) { load() })
    } catch (e: Exception) {
        Result.failure(e)
    }

/** Недоступное устройство — это 503, а не пустой ответ: клиент должен различать эти случаи. */
private suspend fun ApplicationCall.respondDeviceFailure(cause: Throwable) {
    logger.error("Failed to read the device database for ${request.uri}", cause)
    respond(
        HttpStatusCode.ServiceUnavailable,
        ErrorResponse(cause.message?.take(300) ?: "Device database is not readable"),
    )
}
