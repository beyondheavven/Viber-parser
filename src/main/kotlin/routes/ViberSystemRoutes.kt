package com.viber.routes

import com.viber.models.ViberStartRequest
import com.viber.routes.docs.describeGetViberStatus
import com.viber.routes.docs.describeStartViber
import io.ktor.http.HttpStatusCode
import io.ktor.server.request.receive
import io.ktor.server.routing.Route
import io.github.smiley4.ktoropenapi.post
import io.github.smiley4.ktoropenapi.get
import io.ktor.server.routing.route

fun Route.viberSystemRoutes() {
    route("/viber"){
        post("/start", describeStartViber){
            val request = call.receive<ViberStartRequest>()
            val result = startViber(request)
            call.respond(
                if (result.success) HttpStatusCode.OK else HttpStatusCode.InternalServerError,
                result
            )
        }

        get("/status", describeGetViberStatus){
            val status = getViberStatus()
            call.respond(
                if (status.success) HttpStatusCode.OK else HttpStatusCode.InternalServerError,
                status
            )
        }
    }
}