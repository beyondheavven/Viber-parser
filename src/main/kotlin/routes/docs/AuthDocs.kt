package com.viber.routes.docs

import com.viber.models.CallRequest
import com.viber.models.CodeRequest
import com.viber.models.ErrorResponse
import com.viber.models.LoginRequest
import com.viber.models.LoginResponse
import com.viber.models.QrStartRequest
import com.viber.models.QrStartResponse
import com.viber.models.QrStatus
import io.github.smiley4.ktoropenapi.config.RouteConfig
import io.ktor.http.HttpStatusCode

val describeLogin: RouteConfig.() -> Unit = {
    operationId = "Login"
    tags = listOf("Authentication")
    description = "Выдаёт Viber все разрешения (pm grant), выбирает страну, вводит номер телефона и нажимает " +
            "«Позвонить мне» (Call me): код — последние цифры номера, с которого позвонит Viber. " +
            "verification в ответе: call — звонок запрошен, sms — кнопки не было."
    request {
        body<LoginRequest> {
            description = "phoneNumber (напр. '+48123456789' — страна берётся из кода номера), countryName (напр. 'Belarus'), " +
                    "deviceId — инстанс, requestCall=false — не нажимать «Позвонить мне». " +
                    "phoneNumber и страна по умолчанию — VIBER_DEFAULT_PHONE и VIBER_DEFAULT_COUNTRY."
            required = false
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

val describeStartQrLogin: RouteConfig.() -> Unit = {
    operationId = "startQrLogin"
    tags = listOf("Authentication")
    summary = "Вход в Viber по QR-коду (вторым устройством)"
    description = "Открывает в Viber экран активации вторым устройством и запускает фоновое слежение за QR-кодом. " +
            "SMS не отправляется: номер нужен только чтобы Viber нашёл существующий аккаунт, подтверждение " +
            "приходит с основного телефона. Ответ приходит сразу, сам код — через GET /api/auth/qr/status."
    request {
        body<QrStartRequest> {
            description = "phoneNumber (напр. '+48123456789', по умолчанию VIBER_DEFAULT_PHONE), countryCode ('48') — " +
                    "если номер без '+', clearData — очистить данные Viber перед входом, userName — имя профиля, если Viber спросит."
            required = false
        }
    }
    response {
        code(HttpStatusCode.OK) {
            description = "Сессия запущена"
            body<QrStartResponse>()
        }
        code(HttpStatusCode.BadRequest) {
            description = "Номер не указан или некорректен"
            body<ErrorResponse>()
        }
        code(HttpStatusCode.Conflict) {
            description = "Вход по QR уже идёт или эмулятор занят другой задачей"
            body<ErrorResponse>()
        }
    }
}

val describeGetQrLoginStatus: RouteConfig.() -> Unit = {
    operationId = "getQrLoginStatus"
    tags = listOf("Authentication")
    summary = "Состояние входа по QR-коду"
    description = "Отдаёт состояние сессии (idle, starting, qr_ready, scanned, finishing, ready, error, unknown_screen) " +
            "и текущий QR-код: qr.svg — перерисованный вектор, qr.pngBase64 — вырезка со скриншота. " +
            "Опрашивайте раз в пару секунд: Viber может сменить код. При unknown_screen приходит скриншот экрана."
    response {
        code(HttpStatusCode.OK) {
            description = "Состояние сессии"
            body<QrStatus>()
        }
    }
}

val describeCancelQrLogin: RouteConfig.() -> Unit = {
    operationId = "cancelQrLogin"
    tags = listOf("Authentication")
    summary = "Отменить вход по QR-коду"
    description = "Останавливает фоновое слежение, возвращает исходную плотность экрана и освобождает эмулятор."
    response {
        code(HttpStatusCode.OK) {
            description = "Сессия остановлена"
            body<QrStartResponse>()
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

val describeRequestCall: RouteConfig.() -> Unit = {
    operationId = "requestCall"
    tags = listOf("Authentication")
    summary = "Повторный звонок для подтверждения"
    description = "Нажимает «Позвонить мне» на экране ввода кода — если первый звонок пропущен."
    request {
        body<CallRequest> {
            description = "deviceId — инстанс"
            required = false
        }
    }
    response {
        code(HttpStatusCode.OK) {
            description = "Звонок запрошен"
            body<LoginResponse>()
        }
        code(HttpStatusCode.BadRequest) {
            description = "Кнопка «Позвонить мне» сейчас недоступна"
            body<LoginResponse>()
        }
    }
}
