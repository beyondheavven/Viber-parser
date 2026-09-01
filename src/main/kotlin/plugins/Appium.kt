package com.viber.plugins

import com.viber.appium.AppiumManager
import com.viber.config.AppiumSettings
import io.ktor.server.application.Application
import io.ktor.server.application.ApplicationStopping
import io.ktor.server.application.log

/**
 * Прокидывает секцию `appium` из `application.yaml` в [AppiumManager] и гасит сессию
 * при остановке сервера, чтобы на LDPlayer не оставался висеть UiAutomator2-сервер.
 */
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
