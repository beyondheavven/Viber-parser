package com.viber.routes

import com.viber.device.DeviceDatabase
import com.viber.device.ViberDatabase
import com.viber.dto.ErrorResponse
import com.viber.dto.toGroupsResponse
import com.viber.dto.toMembersResponse
import com.viber.routes.docs.GroupDocs
import io.github.smiley4.ktoropenapi.get
import io.github.smiley4.ktoropenapi.route
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.ApplicationCall
import io.ktor.server.request.uri
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.slf4j.Logger
import org.slf4j.LoggerFactory

private val logger: Logger = LoggerFactory.getLogger("GroupRoutes")

fun Route.groupRoutes(database: () -> ViberDatabase = { DeviceDatabase.viber }) {

    route("/group", GroupDocs.group) {
        get("/groups", GroupDocs.groups) {
            readDevice { database().groups().toGroupsResponse() }
                .onSuccess { call.respond(HttpStatusCode.OK, it) }
                .onFailure { call.respondDeviceFailure(it) }
        }

        get("/groups/{id}/members", GroupDocs.groupMembers) {
            val conversationId = call.parameters["id"]?.toLongOrNull()
            if (conversationId == null) {
                call.respond(HttpStatusCode.BadRequest, ErrorResponse("Group id must be a number"))
                return@get
            }
            val includeInactive = call.request.queryParameters["includeInactive"].toBoolean()

            readDevice {
                val database = database()
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
}



private suspend fun <T> readDevice(load: () -> T): Result<T> =
    try {
        Result.success(withContext(Dispatchers.IO) { load() })
    } catch (e: Exception) {
        Result.failure(e)
    }

private suspend fun ApplicationCall.respondDeviceFailure(cause: Throwable) {
    logger.error("Failed to read the device database for ${request.uri}", cause)
    respond(
        HttpStatusCode.ServiceUnavailable,
        ErrorResponse(cause.message?.take(300) ?: "Device database is not readable"),
    )
}
