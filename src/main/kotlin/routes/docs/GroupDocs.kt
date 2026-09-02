package com.viber.routes.docs

import com.viber.dto.ErrorResponse
import com.viber.dto.GroupsResponse
import com.viber.dto.MembersResponse
import io.github.smiley4.ktoropenapi.config.RouteConfig
import io.ktor.http.HttpStatusCode

object GroupDocs {

    val group: RouteConfig.() -> Unit = {
        tags = listOf("Groups")
    }

    val groups: RouteConfig.() -> Unit = {
        description = "Reads the list of Viber groups from the on-device database"
        response {
            code(HttpStatusCode.OK) {
                description = "List of groups"
                body<GroupsResponse>()
            }
            code(HttpStatusCode.ServiceUnavailable) {
                description = "Device database is not readable"
                body<ErrorResponse>()
            }
        }
    }

    val groupMembers: RouteConfig.() -> Unit = {
        description = "Reads the members of a group from the on-device database"
        request {
            pathParameter<Long>("id") {
                description = "Conversation id of the group"
            }
            queryParameter<Boolean>("includeInactive") {
                description = "Whether to include inactive members in the result"
                required = false
            }
        }
        response {
            code(HttpStatusCode.OK) {
                description = "Group with its members"
                body<MembersResponse>()
            }
            code(HttpStatusCode.BadRequest) {
                description = "Group id is not a valid number"
                body<ErrorResponse>()
            }
            code(HttpStatusCode.NotFound) {
                description = "No group with the given conversation id"
                body<ErrorResponse>()
            }
            code(HttpStatusCode.ServiceUnavailable) {
                description = "Device database is not readable"
                body<ErrorResponse>()
            }
        }
    }
}