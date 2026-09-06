package com.viber.routes

import com.viber.clients.AdbClient
import com.viber.clients.AutomationClient
import com.viber.config.AdbSettings
import com.viber.config.AutomationSettings
import com.viber.services.AuthService
import com.viber.services.ViberSystemService
import io.github.smiley4.ktoropenapi.openApi
import io.github.smiley4.ktorswaggerui.swaggerUI
import io.ktor.server.application.Application
import io.ktor.server.routing.route
import io.ktor.server.routing.routing

fun Application.configureRouting() {
    val appConfig = environment.config

    val adbSettings = AdbSettings.from(appConfig)
    val automationSettings = AutomationSettings.from(appConfig)

    val adbClient = AdbClient(adbSettings)
    val automationClient = AutomationClient(automationSettings)

    val authService = AuthService(adbClient)
    val viberSystemService = ViberSystemService(adbClient)

    routing {
        route("api.json") {
            openApi()
        }

        route("swagger") {
            swaggerUI("/api.json")
        }

        route("/api") {
            viberSystemRoutes(viberSystemService)
            authRoutes(authService)
            proxyRoutes(automationClient)
        }
    }
}
