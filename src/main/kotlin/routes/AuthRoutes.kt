package com.viber.routes

import com.viber.models.CodeRequest
import com.viber.models.LoginRequest
import com.viber.routes.docs.describeEnterCode
import com.viber.routes.docs.describeLogin
import io.github.smiley4.ktoropenapi.post
import io.ktor.http.HttpStatusCode
import io.ktor.server.request.receive
import io.ktor.server.routing.Route
import io.ktor.server.routing.route


fun Route.authRoutes() {
    route("/auth") {
        post("/phone", describeLogin){
            val request = call.receive<LoginRequest>()
            val result = enterPhoneNumber(request)
            call.respond(
                if(result.success) HttpStatusCode.OK else HttpStatusCode.BadRequest,
                result
            )
        }

        post("/code", describeEnterCode) {
            val request = call.receive<CodeRequest>()
            val result = enterCode(request)
            call.respond(
                if (result.success) HttpStatusCode.OK else HttpStatusCode.BadRequest,
                result
            )
        }
    }
}