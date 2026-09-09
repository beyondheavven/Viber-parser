package com.viber.routes.docs

import com.viber.models.CodeRequest
import com.viber.models.ErrorResponse
import com.viber.models.LoginRequest
import com.viber.models.LoginResponse
import io.github.smiley4.ktoropenapi.config.RouteConfig
import io.ktor.http.HttpStatusCode

val describeLogin: RouteConfig.() -> Unit = {
    operationId = "Login"
    tags = listOf("Authentication")
    description = "Выбирает страну из списка (по имени, напр. Belarus), вводит номер телефона и автоматически запрашивает звонок (Call me)."
    request {
        body<LoginRequest> {
            description = "Данные для ввода номера: phoneNumber (напр. '336433350' или '+375336433350'), countryName (напр. 'Belarus') или countryCode ('BY')"
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
    operationId = "Enter Code"
    tags = listOf("Authentication")
    description = "Вводит код активации (последние 4 цифры входящего проверочного звонка или SMS)."
    request {
        body<CodeRequest> {
            description = "Последние 4 цифры звонившего номера (код активации)"
            required = true
        }
    }
    response {
        code(HttpStatusCode.OK) {
            description = "Код введён, авторизация завершена"
            body<LoginResponse>()
        }
        code(HttpStatusCode.BadRequest) {
            description = "Неверный код или ошибка"
            body<ErrorResponse>()
        }
    }
}