package com.viber.plugins

import io.github.smiley4.ktoropenapi.OpenApi
import io.ktor.server.application.Application
import io.ktor.server.application.install

fun Application.configureOpenApi() {
    install(OpenApi) {
        info {
            title = "Viber Parser API"
            version = "1.0"
        }
    }
}