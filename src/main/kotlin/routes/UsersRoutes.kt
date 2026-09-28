package com.viber.routes

import com.viber.routes.docs.describeDeleteGroup
import com.viber.routes.docs.describeGetGroupUsers
import com.viber.routes.docs.describeListUsers
import com.viber.routes.docs.describeSyncAllUsers
import com.viber.routes.docs.describeSyncGroupUsers
import com.viber.routes.docs.describeSyncTaskUsers
import com.viber.routes.docs.describeUsersSyncStatus
import com.viber.services.UsersSyncService
import io.github.smiley4.ktoropenapi.delete
import io.github.smiley4.ktoropenapi.get
import io.github.smiley4.ktoropenapi.post
import io.ktor.http.HttpStatusCode
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.route
import java.nio.charset.StandardCharsets
import java.security.MessageDigest

fun Route.usersRoutes(usersSyncService: UsersSyncService, parserSecret: String?) {
    route("/users") {
        get("", describeListUsers) {
            val query = call.request.queryParameters
            val page = usersSyncService.listUsers(
                limit = query["limit"]?.toIntOrNull() ?: 100,
                offset = query["offset"]?.toIntOrNull() ?: 0,
                phone = query["phone"],
                name = query["name"],
            )
            call.respond(HttpStatusCode.OK, page)
        }

        get("/sync/status", describeUsersSyncStatus) {
            val conversationId = call.request.queryParameters["conversationId"]?.toIntOrNull()
            call.respond(HttpStatusCode.OK, usersSyncService.syncStatus(conversationId))
        }

        delete("/groups/{id}", describeDeleteGroup) {
            if (!matchesParserSecret(parserSecret, call.request.headers["x-parser-secret"])) {
                call.respond(HttpStatusCode.Unauthorized, mapOf("error" to "Unauthorized"))
                return@delete
            }
            val id = call.parameters["id"]?.toLongOrNull()?.takeIf { it > 0 }
            if (id == null) {
                call.respond(HttpStatusCode.BadRequest, mapOf("error" to "Некорректный ID группы"))
                return@delete
            }
            val deleted = usersSyncService.deleteGroup(id)
            if (deleted == null) {
                call.respond(HttpStatusCode.NotFound, mapOf("error" to "Группа с ID $id не найдена"))
                return@delete
            }
            call.respond(HttpStatusCode.OK, deleted)
        }

        post("/sync/all", describeSyncAllUsers) {
            call.respond(HttpStatusCode.OK, usersSyncService.syncAll())
        }

        get("/group/{id}", describeGetGroupUsers) {
            val id = call.parameters["id"]!!
            call.respond(HttpStatusCode.OK, usersSyncService.getGroupUsers(id))
        }

        post("/sync/group/{id}", describeSyncGroupUsers) {
            val id = call.parameters["id"]!!.toInt()
            call.respond(HttpStatusCode.OK, usersSyncService.syncGroup(id))
        }

        post("/sync/task/{id}", describeSyncTaskUsers) {
            val id = call.parameters["id"]!!
            call.respond(HttpStatusCode.OK, usersSyncService.syncTask(id))
        }
    }
}

private fun matchesParserSecret(configured: String?, provided: String?): Boolean {
    val expected = configured?.takeIf { it.isNotBlank() } ?: return false
    val actual = provided?.takeIf { it.isNotEmpty() } ?: return false
    return MessageDigest.isEqual(
        expected.toByteArray(StandardCharsets.UTF_8),
        actual.toByteArray(StandardCharsets.UTF_8),
    )
}
