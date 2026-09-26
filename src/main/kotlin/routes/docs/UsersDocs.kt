package com.viber.routes.docs

import com.viber.models.ParticipantModel
import com.viber.models.UsersPage
import com.viber.models.UsersSyncAllResult
import com.viber.models.UsersSyncResult
import com.viber.models.UsersSyncStatus
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

val describeUsersSyncStatus: RouteConfig.() -> Unit = {
    operationId = "usersSyncStatus"
    tags = listOf("Users")
    summary = "Проверить, записались ли данные в Supabase"
    description = "Только чтение. Показывает, настроен ли Supabase и отвечает ли он, сколько строк " +
            "в viber_users, viber_groups и viber_group_members, и по каждой группе: сколько " +
            "пользователей записала последняя синхронизация, сколько участников активно и когда " +
            "она прошла. Ошибку подключения возвращает в поле message с reachable = false, " +
            "а не кодом 500."

    request {
        queryParameter<Int>("conversationId") {
            description = "ID беседы (как в /api/groups), чтобы проверить только одну группу"
            required = false
        }
    }

    response {
        code(HttpStatusCode.OK) {
            description = "Состояние записей в Supabase"
            body<UsersSyncStatus>()
        }
    }
}

val describeSyncAllUsers: RouteConfig.() -> Unit = {
    operationId = "syncAllUsers"
    tags = listOf("Users")
    summary = "Выгрузить всех пользователей со всех групп в Supabase"
    description = "Отдельная операция массовой загрузки: проходит по всем группам и сообществам " +
            "на устройстве и для каждой делает то же, что /api/users/sync/group/{id}. Группа, " +
            "которая не выгрузилась, попадает в failed и не останавливает остальные. Один человек " +
            "из нескольких групп хранится одной строкой в viber_users."

    response {
        code(HttpStatusCode.OK) {
            description = "Итог загрузки по каждой группе"
            body<UsersSyncAllResult>()
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

val describeGetGroupUsers: RouteConfig.() -> Unit = {
    operationId = "getGroupUsers"
    tags = listOf("Users")
    summary = "Получить участников группы из Supabase"
    description = "Возвращает сохранённых участников группы из базы данных Supabase (viber_group_members + viber_users)."

    request {
        pathParameter<String>("id") {
            description = "ID беседы (conversationId) или ключ группы (viberGroupId / groupKey)"
            required = true
        }
    }

    response {
        code(HttpStatusCode.OK) {
            description = "Список участников группы"
            body<List<ParticipantModel>>()
        }
        code(HttpStatusCode.InternalServerError) {
            description = "Supabase не настроен или недоступен"
        }
    }
}

