package com.viber.routes

import com.viber.models.ViberStartRequest
import com.viber.routes.docs.describeGetViberStatus
import com.viber.routes.docs.describeStartViber
import com.viber.services.ViberSystemService
import io.ktor.http.HttpStatusCode
import io.ktor.server.request.receive
import io.ktor.server.routing.Route
import io.ktor.server.response.respond
import io.github.smiley4.ktoropenapi.post
import io.github.smiley4.ktoropenapi.get
import io.ktor.server.routing.route

fun Route.viberSystemRoutes(viberSystemService: ViberSystemService) {
    route("/viber"){
        post("/start", describeStartViber){
            val request = call.receive<ViberStartRequest>()
            val result = viberSystemService.startViber(request)
            if (result.success) {
                call.respond(HttpStatusCode.OK, result)
            } else {
                call.respond(HttpStatusCode.InternalServerError, result)
            }
        }

        get("/status", describeGetViberStatus){
            val status = viberSystemService.getViberStatus()
            if (status.isRunning) {
                call.respond(HttpStatusCode.OK, status)
            } else {
                call.respond(HttpStatusCode.ServiceUnavailable, status)
            }
        }

        get("/account") {
            val account = viberSystemService.getAccountInfo()
            call.respond(HttpStatusCode.OK, account)
        }
    }
}