package com.viber.routes.docs

import com.viber.models.UsersPage
import com.viber.models.UsersSyncResult
import io.github.smiley4.ktoropenapi.config.RouteConfig
import io.ktor.http.HttpStatusCode

val describeListUsers: RouteConfig.() -> Unit = {
    operationId = "listUsers"
    tags = listOf("Users")
    summary = "Получить пользователей из базы Supabase"
    description = "Постранично возвращает базу пользователей Viber, накопленную в Supabase " +
            "(таблица viber_users). Можно отфильтровать по фрагменту номера или имени."

    request {
        queryParameter<Int>("limit") {
            description = "Размер страницы (1..1000, по умолчанию 100)"
            required = false
        }
        queryParameter<Int>("offset") {
            description = "Смещение (по умолчанию 0)"
            required = false
        }
        queryParameter<String>("phone") {
            description = "Фрагмент номера телефона, только цифры учитываются"
            required = false
        }
        queryParameter<String>("name") {
            description = "Фрагмент имени, без учёта регистра"
            required = false
        }
    }

    response {
        code(HttpStatusCode.OK) {
            description = "Страница пользователей"
            body<UsersPage>()
        }
        code(HttpStatusCode.InternalServerError) {
            description = "Supabase не настроен (SUPABASE_URL / SUPABASE_SERVICE_KEY)"
        }
    }
}

val describeSyncGroupUsers: RouteConfig.() -> Unit = {
    operationId = "syncGroupUsers"
    tags = listOf("Users")
    summary = "Выгрузить участников группы в Supabase"
    description = "Берёт участников группы из локального снимка SQLite бота и записывает их в " +
            "базу пользователей Supabase: viber_users (один человек — одна строка, ключ member_id " +
            "или телефон), viber_groups и связи viber_group_members. Свой аккаунт и записи без " +
            "member_id и номера пропускаются; участники, которых больше нет в группе, помечаются " +
            "неактивными."

    request {
        pathParameter<Int>("id") {
            description = "ID беседы (row ID в SQLite, как в /api/groups)"
            required = true
        }
    }

    response {
        code(HttpStatusCode.OK) {
            description = "Результат синхронизации"
            body<UsersSyncResult>()
        }
        code(HttpStatusCode.NotFound) {
            description = "Группа не найдена"
        }
    }
}

val describeSyncTaskUsers: RouteConfig.() -> Unit = {
    operationId = "syncTaskUsers"
    tags = listOf("Users")
    summary = "Выгрузить результат задачи сбора в Supabase"
    description = "То же, что синхронизация группы, но по результату завершённой задачи " +
            "/api/participants/collect: в нём есть статус онлайн и время последней активности."

    request {
        pathParameter<String>("id") {
            description = "ID задачи со статусом ready"
            required = true
        }
    }

    response {
        code(HttpStatusCode.OK) {
            description = "Результат синхронизации"
            body<UsersSyncResult>()
        }
        code(HttpStatusCode.NotFound) {
            description = "Задача не найдена или ещё не завершена"
        }
    }
}
