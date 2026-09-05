package com.viber.plugins

import com.viber.appium.AppiumManager
import io.ktor.server.application.Application
import io.ktor.server.application.ApplicationStopping
import io.ktor.server.application.log


fun Application.configureAppium() {
    AppiumManager.configure(AppiumSettings.from(environment.config))

    monitor.subscribe(ApplicationStopping) {
        try {
            AppiumManager.stopSession()
        } catch (e: Exception) {
            log.warn("Failed to stop Appium session on shutdown", e)
        }
    }
}
