package com.viber.routes

import com.viber.dto.ErrorResponse
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.ApplicationCall
import io.ktor.server.request.uri
import io.ktor.server.response.respond
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.slf4j.LoggerFactory

/**
 * Общее у маршрутов, которые ходят на устройство синхронно: сам поход и то, как
 * выглядит его провал. В отличие от `/api/start` и `/api/scroll-members` здесь нет
 * многоминутной автоматизации UI — это один короткий запуск adb, ответ которого клиент
 * должен увидеть в том же запросе.
 */
private val logger = LoggerFactory.getLogger("com.viber.plugins.DeviceRouting")

/** Запуск adb блокирует поток — уводим с event loop, падение превращаем в результат. */
internal suspend fun <T> onDevice(work: () -> T): Result<T> =
    try {
        Result.success(withContext(Dispatchers.IO) { work() })
    } catch (e: Exception) {
        Result.failure(e)
    }

/** Недоступное устройство — это 503, а не пустой ответ: клиент должен различать эти случаи. */
internal suspend fun ApplicationCall.respondDeviceFailure(cause: Throwable) {
    logger.error("Device call failed for ${request.uri}", cause)
    respond(
        HttpStatusCode.ServiceUnavailable,
        ErrorResponse(cause.message?.take(300) ?: "Device is not reachable"),
    )
}
