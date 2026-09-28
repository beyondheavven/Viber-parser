package com.viber.routes

import com.viber.infrastructure.adb.AdbClient
import com.viber.bot.ViberBotClient
import com.viber.config.AdbSettings
import com.viber.config.RabbitMqSettings
import com.viber.services.AuthService
import com.viber.services.MonitoredMessageQueryService
import com.viber.services.UsersSyncService
import com.viber.services.ViberSystemService
import com.viber.supabase.supabaseClient
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
    val usersSyncService = UsersSyncService(viberBotClient, supabase = { supabaseClient })
    val monitoredMessageQueryService = MonitoredMessageQueryService(supabase = { supabaseClient })
    val parserSecret = appConfig.propertyOrNull("security.parserSecret")
        ?.getString()
        ?.trim()
        ?.takeIf { it.isNotEmpty() }

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
            messageRoutes(viberBotClient, monitoredMessageQueryService)
            broadcastRoutes(viberBotClient)
            usersRoutes(usersSyncService, parserSecret)
        }
    }
}
