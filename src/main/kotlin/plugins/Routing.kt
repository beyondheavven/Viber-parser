package com.viber.plugins

import appium.ParserState
import com.viber.appium.AppiumManager
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.*
import io.ktor.server.response.*
import io.ktor.server.routing.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

fun Application.configureRouting() {
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
                        e.printStackTrace()
                    }
                }
                call.respond(HttpStatusCode.Accepted, mapOf("message" to "Processing started"))
            }

            get("/status"){
                val statusResponse = mapOf(
                    "state" to AppiumManager.currentState.name,
                    "isDriverActive " to (AppiumManager.driver != null)
                )
                call.respond(HttpStatusCode.OK, statusResponse)
            }

            post("/stop"){
                if(AppiumManager.currentState == ParserState.IDLE){
                    call.respond(HttpStatusCode.BadRequest, mapOf("message" to "Parsing stopped"))
                    return@post
                }
                AppiumManager.stopSession()
                call.respond(HttpStatusCode.Accepted, mapOf("message" to "Appium is stopped"))
            }
        }
    }
}