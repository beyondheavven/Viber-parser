package com.viber.routes

import com.viber.clients.AdbClient
import com.viber.clients.AutomationClient
import com.viber.config.AdbSettings
import com.viber.config.RabbitMqSettings
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
    val rabbitMqSettings = RabbitMqSettings.from(appConfig)

    val adbClient = AdbClient(adbSettings)
    val automationClient = AutomationClient(rabbitMqSettings)

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
            participantsRoutes(automationClient)
            groupRoutes(automationClient)
            tasksRoutes(automationClient)
            databaseRoutes(automationClient)
            messageRoutes(automationClient)
        }
    }
}
