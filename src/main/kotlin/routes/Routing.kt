package com.viber.routes

import com.viber.clients.AdbClient
import com.viber.clients.FridaClient
import com.viber.config.AdbSettings
import com.viber.config.FridaSettings
import com.viber.services.AuthService
import io.github.smiley4.ktoropenapi.openApi
import io.github.smiley4.ktorswaggerui.swaggerUI
import io.ktor.server.application.Application
import io.ktor.server.routing.route
import io.ktor.server.routing.routing

fun Application.configureRouting() {
    val appConfig = environment.config

    val adbSettings = AdbSettings.from(appConfig)
    val fridaSettings = FridaSettings.from(appConfig)

    val adbClient = AdbClient(adbSettings)
    val fridaClient = FridaClient(fridaSettings)

    val authService = AuthService(fridaClient)

    routing {
        route("api.json") {
            openApi()
        }

        route("swagger") {
            swaggerUI("/api.json")
        }

        route("/api") {
            viberSystemRoutes()
            authRoutes(authService)
        }
    }
}
