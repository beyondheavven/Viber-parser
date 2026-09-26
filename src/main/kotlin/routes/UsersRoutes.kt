package com.viber.routes

import com.viber.routes.docs.describeGetGroupUsers
import com.viber.routes.docs.describeListUsers
import com.viber.routes.docs.describeSyncAllUsers
import com.viber.routes.docs.describeSyncGroupUsers
import com.viber.routes.docs.describeSyncTaskUsers
import com.viber.routes.docs.describeUsersSyncStatus
import com.viber.services.UsersSyncService
import io.github.smiley4.ktoropenapi.get
import io.github.smiley4.ktoropenapi.post
import io.ktor.http.HttpStatusCode
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.route

fun Route.usersRoutes(usersSyncService: UsersSyncService) {
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

        get("/group/{id}", describeGetGroupUsers) {
            val id = call.parameters["id"]!!
            call.respond(HttpStatusCode.OK, usersSyncService.getGroupUsers(id))
        }

        get("/sync/status", describeUsersSyncStatus) {
            val conversationId = call.request.queryParameters["conversationId"]?.toIntOrNull()
            call.respond(HttpStatusCode.OK, usersSyncService.syncStatus(conversationId))
        }

        post("/sync/all", describeSyncAllUsers) {
            call.respond(HttpStatusCode.OK, usersSyncService.syncAll())
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
