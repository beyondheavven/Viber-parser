package com.viber.routes

import com.viber.models.CodeRequest
import com.viber.models.LoginRequest
import com.viber.models.QrStartRequest
import com.viber.routes.docs.describeCancelQrLogin
import com.viber.routes.docs.describeEnterCode
import com.viber.routes.docs.describeGetQrLoginStatus
import com.viber.routes.docs.describeLogin
import com.viber.routes.docs.describeStartQrLogin
import com.viber.services.AuthService
import io.github.smiley4.ktoropenapi.get
import io.github.smiley4.ktoropenapi.post
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.server.request.receive
import io.ktor.server.request.receiveNullable
import io.ktor.server.response.respond
import io.ktor.server.response.respondText
import io.ktor.server.routing.Route
import io.ktor.server.routing.route


fun Route.authRoutes(authService: AuthService) {
    route("/auth") {
        post("/phone", describeLogin){
            val request = call.receiveNullable<LoginRequest>() ?: LoginRequest()
            val result = authService.enterPhoneNumber(request)
            if (result.success){
                call.respond(HttpStatusCode.OK, result)
            } else {
                call.respond(HttpStatusCode.BadRequest, result)
            }
        }

        post("/code", describeEnterCode) {
            val request = call.receive<CodeRequest>()
            val result = authService.enterCode(request)
            if (result.success){
                call.respond(HttpStatusCode.OK, result)
            }else {
                call.respond(HttpStatusCode.BadRequest, result)
            }
        }

        route("/qr") {
            post("/start", describeStartQrLogin) {
                val request = call.receiveNullable<QrStartRequest>() ?: QrStartRequest()
                call.respondText(authService.startQrLogin(request), ContentType.Application.Json)
            }

            get("/status", describeGetQrLoginStatus) {
                call.respondText(authService.getQrLoginStatus(), ContentType.Application.Json)
            }

            post("/cancel", describeCancelQrLogin) {
                call.respondText(authService.cancelQrLogin(), ContentType.Application.Json)
            }
        }
    }
}
