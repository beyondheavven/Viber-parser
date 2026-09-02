package com.viber.routes

import com.viber.appium.AppiumManager
import com.viber.appium.ParserState
import com.viber.dto.ScrollMembersRequest
import com.viber.dto.StatusResponse
import com.viber.routes.docs.ParserDocs
import io.github.smiley4.ktoropenapi.get
import io.github.smiley4.ktoropenapi.post
import io.github.smiley4.ktoropenapi.route
import io.ktor.http.HttpStatusCode
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import org.slf4j.Logger
import org.slf4j.LoggerFactory

private val logger: Logger = LoggerFactory.getLogger("ParserRoutes")

fun Route.parserRoutes() {

    route("/parser", ParserDocs.group) {
        post("/start", ParserDocs.start){
            if(AppiumManager.currentState == ParserState.INITIALIZING ||
                AppiumManager.currentState == ParserState.RUNNING){
                call.respond(HttpStatusCode.Conflict, mapOf("error" to "Parser already started"))
                return@post
            }

            call.application.launch(Dispatchers.IO) {
                try {
                    AppiumManager.startSession()
                }catch (e: Exception){
                    logger.error("Error during starting session", e)
                }
            }
            call.respond(HttpStatusCode.Accepted, mapOf("message" to "Processing started"))
        }

        get("/status", ParserDocs.status){
            call.respond(HttpStatusCode.OK,
                StatusResponse(
                    state = AppiumManager.currentState.name,
                    isDriverActive = AppiumManager.driver != null
                )
            )
        }

        post("/scroll-members", ParserDocs.scrollMembers){
            if(AppiumManager.currentState != ParserState.RUNNING){
                call.respond(HttpStatusCode.BadRequest,
                    mapOf("error" to "Session is not running, current state: ${AppiumManager.currentState.name}")
                )
                return@post
            }

            val request = try {
                call.receive<ScrollMembersRequest>()
            }catch (e: Exception){
                call.respond(HttpStatusCode.BadRequest, mapOf("error" to "Request is not valid"))
                return@post
            }

            call.application.launch(Dispatchers.IO) {
                try {
                    AppiumManager.scrollMembers(request.groupName)
                } catch (e: Exception){
                    logger.error("Error during scroll members", e)
                }
            }
            call.respond(HttpStatusCode.Accepted, mapOf("message" to "Scrolling started"))
        }

        post("/stop", ParserDocs.stop){
            if(AppiumManager.currentState == ParserState.IDLE){
                call.respond(HttpStatusCode.BadRequest, mapOf("message" to "Parsing stopped"))
                return@post
            }
            try{
                AppiumManager.stopSession()
                call.respond(HttpStatusCode.Accepted, mapOf("message" to "Appium is stopped"))
            } catch (e: Exception) {
                logger.error("Error during stopping session", e)
                call.respond(HttpStatusCode.BadRequest, mapOf("error" to "Error during stopping session"))
            }
        }
    }
}