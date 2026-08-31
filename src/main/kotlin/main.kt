package com.viber

import com.viber.plugins.configureMonitoring
import com.viber.plugins.configureRouting
import com.viber.plugins.configureSerialization
import io.ktor.server.application.Application

fun Application.module() {
    configureRouting()
    configureSerialization()
    configureMonitoring()
}