package com.viber.routes.docs

import com.viber.models.GroupDetail
import com.viber.models.GroupSummary
import com.viber.models.ParticipantModel
import io.github.smiley4.ktoropenapi.config.RouteConfig
import io.ktor.http.HttpStatusCode

val describeGetGroups: RouteConfig.() -> Unit = {
    operationId = "getGroups"
    tags = listOf("Groups")
    summary = "Получить список групп и чатов Viber"
    description = "Возвращает беседы из локального снимка БД. По умолчанию только группы и " +
            "сообщества (личные чаты 1-to-1 исключены), передайте all=true чтобы включить их."

    response {
        code(HttpStatusCode.OK) {
            description = "Список бесед"
            body<List<GroupSummary>>()
        }
    }
}

val describeGetGroup: RouteConfig.() -> Unit = {
    operationId = "getGroup"
    tags = listOf("Groups")
    summary = "Получить подробную информацию о группе"
    description = "Возвращает данные группы по её ID (row ID беседы) вместе с кратким " +
            "списком активных участников."

    response {
        code(HttpStatusCode.OK) {
            description = "Подробности группы"
            body<GroupDetail>()
        }
        code(HttpStatusCode.NotFound) {
            description = "Группа не найдена"
        }
    }
}

val describeGetGroupParticipants: RouteConfig.() -> Unit = {
    operationId = "getGroupParticipants"
    tags = listOf("Groups")
    summary = "Получить участников группы из БД"
    description = "Возвращает текущий список участников группы, как он сохранён в локальном " +
            "снимке базы данных (без обращения к устройству)."

    response {
        code(HttpStatusCode.OK) {
            description = "Массив участников"
            body<List<ParticipantModel>>()
        }
        code(HttpStatusCode.NotFound) {
            description = "Группа не найдена"
        }
    }
}