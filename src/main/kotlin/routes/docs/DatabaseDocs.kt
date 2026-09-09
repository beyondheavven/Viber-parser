package com.viber.routes.docs

import com.viber.models.DatabaseStats
import com.viber.models.DecodeRequest
import com.viber.models.DecodeResult
import com.viber.models.SyncResult
import io.github.smiley4.ktoropenapi.config.RouteConfig
import io.ktor.http.HttpStatusCode

val describeSyncDatabase: RouteConfig.() -> Unit = {
    operationId = "syncDatabase"
    tags = listOf("Database")
    summary = "Синхронизировать локальный снимок БД"
    description = "Копирует боевую SQLite-базу Viber с эмулятора в локальный снимок " +
            "automation-сервиса. Все /api/groups и /api/database эндпоинты читают из этого снимка."

    response {
        code(HttpStatusCode.OK) {
            description = "Синхронизация выполнена"
            body<SyncResult>()
        }
    }
}

val describeGetDatabaseStats: RouteConfig.() -> Unit = {
    operationId = "getDatabaseStats"
    tags = listOf("Database")
    summary = "Получить статистику базы данных"
    description = "Возвращает количество бесед, участников (включая недешифрованных) и " +
            "сообщений в текущем локальном снимке БД."

    response {
        code(HttpStatusCode.OK) {
            description = "Статистика БД"
            body<DatabaseStats>()
        }
    }
}

val describeDecodeParticipants: RouteConfig.() -> Unit = {
    operationId = "decodeParticipants"
    tags = listOf("Database")
    summary = "Дешифровать недешифрованные member_id"
    description = "Находит записи участников с зашифрованным member_id (формат em:...) и " +
            "дешифрует их в боевой базе данных эмулятора. Поддерживает режим предпросмотра (dryRun)."

    request {
        body<DecodeRequest> {
            description = "Параметры дешифровки"
            required = false
        }
    }

    response {
        code(HttpStatusCode.OK) {
            description = "Результат дешифровки"
            body<DecodeResult>()
        }
    }
}