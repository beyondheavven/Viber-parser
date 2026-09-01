package com.viber.plugins

import com.viber.config.DatabaseSettings
import com.viber.db.DeviceDatabase
import io.ktor.server.application.Application

/** Прокидывает секцию `database` из `application.yaml` в [DeviceDatabase]. */
fun Application.configureDatabase() {
    DeviceDatabase.configure(DatabaseSettings.from(environment.config))
}
