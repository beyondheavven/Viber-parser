package com.viber.routes

import com.viber.clients.AdbClient
import com.viber.clients.ViberBotClient
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
    val viberBotClient = ViberBotClient(rabbitMqSettings)

    val authService = AuthService(viberBotClient)
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
            participantsRoutes(viberBotClient)
            groupRoutes(viberBotClient)
            tasksRoutes(viberBotClient)
            databaseRoutes(viberBotClient)
            messageRoutes(viberBotClient)
            broadcastRoutes(viberBotClient)
        }
    }
}
