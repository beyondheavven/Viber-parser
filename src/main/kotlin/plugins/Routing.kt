package com.viber.plugins

import org.slf4j.LoggerFactory
import com.viber.appium.AppiumManager
import com.viber.appium.ParserState
import com.viber.dto.ScrollMembersRequest
import com.viber.dto.StatusResponse
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.*
import io.ktor.server.request.receive
import io.ktor.server.response.*
import io.ktor.server.routing.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch




fun Application.configureRouting() {
    val logger = LoggerFactory.getLogger(this::class.java)

    routing {
        get("/health") {
            call.respondText("Parser started", status = HttpStatusCode.OK)
        }

        route("/api"){
            post("/start"){
                if(AppiumManager.currentState == ParserState.INITIALIZING ||
                    AppiumManager.currentState == ParserState.RUNNING){
                    call.respond(HttpStatusCode.Conflict, mapOf("error" to "Parser already started"))
                    return@post
                }

                launch(Dispatchers.IO) {
                    try {
                        AppiumManager.startSession()
                    }catch (e: Exception){
                        logger.error("Error during starting session", e)
                    }
                }
                call.respond(HttpStatusCode.Accepted, mapOf("message" to "Processing started"))
            }

            get("/status"){
                call.respond(HttpStatusCode.OK,
                    StatusResponse(
                        state = AppiumManager.currentState.name,
                        isDriverActive = AppiumManager.driver != null
                    )
                )
            }

            post("/scroll-members"){
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

                launch(Dispatchers.IO) {
                    try {
                        AppiumManager.scrollMembers(request.groupName)
                    } catch (e: Exception){
                        logger.error("Error during scroll members", e)
                    }
                }
                call.respond(HttpStatusCode.Accepted, mapOf("message" to "Scrolling started"))
            }

            post("/stop"){
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
}