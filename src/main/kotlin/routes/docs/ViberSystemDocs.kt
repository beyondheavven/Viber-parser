package com.viber.routes.docs

import com.viber.models.ErrorResponse
import com.viber.models.ViberStartRequest
import com.viber.models.ViberStartResponse
import com.viber.models.ViberStatusResponse
import io.github.smiley4.ktoropenapi.config.RouteConfig
import io.ktor.http.HttpStatusCode

val describeStartViber: RouteConfig.() -> Unit = {
    operationId = "startViber"
    tags = listOf("Viber System")
    summary = "Запустить Viber"
    description = "Запускает приложение Viber через ADB. Опционально очищает данные."

    request {
        body<ViberStartRequest> {
            description = "Параметры запуска"
            required = true
        }
    }

    response {
        code(HttpStatusCode.OK) {
            description = "Viber успешно запущен"
            body<ViberStartResponse>()
        }
        code(HttpStatusCode.InternalServerError) {
            description = "Ошибка запуска"
            body<ErrorResponse>()
        }
    }
}

val describeGetViberStatus: RouteConfig.() -> Unit = {
    operationId = "getViberStatus"
    tags = listOf("Viber System")
    summary = "Статус Viber"
    description = "Проверяет, запущен ли процесс Viber и находится ли он на переднем плане."

    response {
        code(HttpStatusCode.OK) {
            description = "Текущий статус получен"
            body<ViberStatusResponse>()
        }
        code(HttpStatusCode.ServiceUnavailable) {
            description = "Эмулятор недоступен"
            body<ErrorResponse>()
        }
    }
}