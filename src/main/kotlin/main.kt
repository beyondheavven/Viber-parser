package com.viber

import com.viber.plugins.configureAppium
import com.viber.plugins.configureDatabase
import com.viber.plugins.configureMonitoring
import com.viber.routes.configureRouting
import com.viber.plugins.configureSerialization
import io.ktor.server.application.Application

fun Application.module() {
    configureAppium()
    configureDatabase()
    configureRouting()
    configureSerialization()
    configureMonitoring()
}
