package com.viber.routes.docs

import com.viber.models.CollectParticipantsRequest
import com.viber.models.OnlineStatusItem
import com.viber.models.ParticipantModel
import com.viber.models.QueryOnlineStatusRequest
import com.viber.models.TaskCreatedResponse
import io.github.smiley4.ktoropenapi.config.RouteConfig
import io.ktor.http.HttpStatusCode


val describeCollectParticipants: RouteConfig.() -> Unit = {
    operationId = "collectParticipants"
    tags = listOf("Participants")
    summary = "Запустить сбор участников группы"
    description = "Запускает фоновую задачу сбора участников группы/сообщества через Frida " +
            "и Appium. Задача выполняется асинхронно — прогресс отслеживается через /api/tasks/{id}."

    request {
        body<CollectParticipantsRequest> {
            description = "Целевая группа и параметры сбора"
            required = true
        }
    }

    response {
        code(HttpStatusCode.Accepted) {
            description = "Задача принята к исполнению"
            body<TaskCreatedResponse>()
        }
        code(HttpStatusCode.Conflict) {
            description = "Эмулятор занят выполнением другой задачи"
        }
    }
}

val describeGetTaskParticipants: RouteConfig.() -> Unit = {
    operationId = "getTaskParticipants"
    tags = listOf("Participants")
    summary = "Получить участников завершённой задачи"
    description = "Возвращает список участников, собранных задачей, чей статус ready."

    request {
        pathParameter<String>("id") {
            description = "ID задачи сбора участников"
            required = true
        }
    }

    response {
        code(HttpStatusCode.OK) {
            description = "Массив участников"
            body<List<ParticipantModel>>()
        }
        code(HttpStatusCode.NotFound) {
            description = "Задача не найдена или результат ещё не готов"
        }
    }
}

val describeGetOnlineStatuses: RouteConfig.() -> Unit = {
    operationId = "getOnlineStatuses"
    tags = listOf("Participants")
    summary = "Запросить онлайн-статус участников"
    description = "Возвращает признак 'в сети' и дату последней активности для списка " +
            "участников — по memberId напрямую или по номерам телефонов (сопоставляются с БД)."

    request {
        body<QueryOnlineStatusRequest> {
            description = "memberId и/или номера телефонов для проверки"
            required = true
        }
    }

    response {
        code(HttpStatusCode.OK) {
            description = "Массив статусов активности"
            body<List<OnlineStatusItem>>()
        }
    }
}