package com.viber

import com.viber.plugins.configureMonitoring
import com.viber.routes.configureRouting
import com.viber.plugins.configureOpenApi
import com.viber.plugins.configureSerialization
import com.viber.supabase.configureSupabaseClient
import io.ktor.server.application.Application

fun Application.module() {
    configureRouting()
    configureSerialization()
    configureMonitoring()
    configureOpenApi()
    configureSupabaseClient()
}
