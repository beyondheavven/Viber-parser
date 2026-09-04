package com.viber.routes.docs

import com.viber.dto.ScrollMembersRequest
import com.viber.dto.StatusResponse
import io.github.smiley4.ktoropenapi.config.RouteConfig
import io.ktor.http.HttpStatusCode

object ParserDocs {

    val group: RouteConfig.() -> Unit = {
        tags = listOf("Parser configuring")
    }

    val start: RouteConfig.() -> Unit = {
        description = "Starts an Appium session and moves the parser into the RUNNING state"
        response {
            code(HttpStatusCode.Accepted) {
                description = "Processing has started"
            }
            code(HttpStatusCode.Conflict) {
                description = "Parser is already running (state is INITIALIZING or RUNNING)"
            }
        }
    }

    val status: RouteConfig.() -> Unit = {
        description = "Returns the current parser state and Appium driver status"
        response {
            code(HttpStatusCode.OK) {
                description = "Current parser state"
                body<StatusResponse>()
            }
        }
    }

    val scrollMembers: RouteConfig.() -> Unit = {
        description = "Starts scrolling through the members list of the given group"
        request {
            body<ScrollMembersRequest> {
                description = "Name of the group"
                required = true
            }
        }
        response {
            code(HttpStatusCode.Accepted) {
                description = "Scrolling has started"
            }
            code(HttpStatusCode.BadRequest) {
                description = "Parser is not in the RUNNING state, or the request body is invalid"
            }
        }
    }

    val stop: RouteConfig.() -> Unit = {
        description = "Stops the Appium session of the parser"
        response {
            code(HttpStatusCode.Accepted) {
                description = "Appium session stopped"
            }
            code(HttpStatusCode.BadRequest) {
                description = "Parser is already IDLE, or an error occurred while stopping"
            }
        }
    }
}