package com.viber.routes.docs

import com.viber.models.CodeRequest
import com.viber.models.ErrorResponse
import com.viber.models.LoginRequest
import com.viber.models.LoginResponse
import io.github.smiley4.ktoropenapi.config.RouteConfig
import io.ktor.http.HttpStatusCode

val describeLogin: RouteConfig.() -> Unit = {
    description = "Вводит номер телефона в экран регистрации Viber через Frida."
    request {
        body<LoginRequest> {
            description = "Данные для ввода номера"
            required = true
        }
    }
    response {
        code(HttpStatusCode.OK) {
            description = "Номер введён"
            body<LoginResponse>()
        }
        code(HttpStatusCode.BadRequest) {
            description = "Неверный формат или ошибка Frida"
            body<ErrorResponse>()
        }
    }
}

val describeEnterCode: RouteConfig.() -> Unit = {
    description = "Вводит SMS-код для подтверждения номера."
    request {
        body<CodeRequest> {
            description = "Код из SMS"
            required = true
        }
    }
    response {
        code(HttpStatusCode.OK) {
            description = "Код введён"
            body<LoginResponse>()
        }
        code(HttpStatusCode.BadRequest) {
            description = "Неверный код или ошибка"
            body<ErrorResponse>()
        }
    }
}