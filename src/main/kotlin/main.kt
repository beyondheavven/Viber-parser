package com.viber

import com.viber.plugins.configureAppium
import com.viber.plugins.configureDatabase
import com.viber.plugins.configureMonitoring
import com.viber.plugins.configureOpenApi
import com.viber.plugins.configureRouting
import com.viber.plugins.configureSerialization
import com.viber.supabase.configureSupabaseClient
import io.ktor.server.application.Application

fun Application.module() {
    configureAppium()
    configureDatabase()
    configureRouting()
    configureSerialization()
    configureMonitoring()
    configureOpenApi()
    configureSupabaseClient()
}
