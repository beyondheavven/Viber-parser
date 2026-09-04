package com.viber.plugins

import com.viber.config.DatabaseSettings
import com.viber.device.DeviceDatabase
import io.ktor.server.application.Application

fun Application.configureDatabase() {
    DeviceDatabase.configure(DatabaseSettings.from(environment.config))
}
