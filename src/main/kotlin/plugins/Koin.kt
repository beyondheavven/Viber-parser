package com.viber.plugins

import com.viber.clients.AdbClient
import com.viber.clients.ViberBotClient
import com.viber.config.AdbSettings
import com.viber.config.RabbitMqSettings
import io.ktor.server.application.Application
import io.ktor.server.application.install
import org.koin.dsl.module
import org.koin.ktor.plugin.Koin

fun Application.configureDI() {

    val appModule = module {

        single(createdAtStart = true) { AdbSettings.from(environment.config) }

        single(createdAtStart = true) { RabbitMqSettings.from(environment.config) }

        single { RabbitMqSettings(get()) }

        single { AdbClient(get()) }

        single { ViberBotClient(get<RabbitMqSettings>()) }
    }

    install(Koin) {
        modules(appModule)
    }


}