package com.viber

import com.viber.clients.AdbClient
import com.viber.clients.FridaClient
import com.viber.config.AdbSettings
import com.viber.config.FridaSettings
import com.viber.plugins.configureMonitoring
import com.viber.routes.configureRouting
import com.viber.plugins.configureOpenApi
import com.viber.plugins.configureSerialization
import com.viber.supabase.configureSupabaseClient
import io.ktor.server.application.Application

fun Application.module() {
    val adbSettings = AdbSettings.from(environment.config)
    val fridaSettings = FridaSettings.from(environment.config)

    val adbClient = AdbClient(adbSettings)
    val fridaClient = FridaClient(fridaSettings)

    configureRouting()
    configureSerialization()
    configureMonitoring()
    configureOpenApi()
    configureSupabaseClient()
}
