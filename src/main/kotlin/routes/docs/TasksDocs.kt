package com.viber.routes.docs

import com.viber.models.StopTaskResponse
import com.viber.models.TaskDetail
import com.viber.models.TaskSummary
import io.github.smiley4.ktoropenapi.config.RouteConfig
import io.ktor.http.HttpStatusCode

val describeGetAllTasks: RouteConfig.() -> Unit = {
    operationId = "getAllTasks"
    tags = listOf("Tasks")
    summary = "Получить список всех задач"
    description = "Возвращает все фоновые задачи automation-сервиса. Можно отфильтровать " +
            "по статусу (initializing, starting, running, stopped, error, ready)."

    request {
        queryParameter<String>("status") {
            description = "Фильтр по статусу (initializing, starting, running, stopped, error, ready)"
            required = false
        }
    }

    response {
        code(HttpStatusCode.OK) {
            description = "Список задач"
            body<List<TaskSummary>>()
        }
    }
}

val describeGetTaskDetail: RouteConfig.() -> Unit = {
    operationId = "getTaskDetail"
    tags = listOf("Tasks")
    summary = "Получить подробный статус задачи"
    description = "Возвращает статус задачи вместе с историей выполненных шагов и, если " +
            "задача завершена успешно (status = ready), итоговым результатом."

    request {
        pathParameter<String>("id") {
            description = "ID задачи"
            required = true
        }
    }

    response {
        code(HttpStatusCode.OK) {
            description = "Подробности задачи"
            body<TaskDetail>()
        }
        code(HttpStatusCode.NotFound) {
            description = "Задача не найдена"
        }
    }
}

val describeStopTask: RouteConfig.() -> Unit = {
    operationId = "stopTask"
    tags = listOf("Tasks")
    summary = "Остановить выполнение задачи"
    description = "Отправляет сигнал остановки активной задаче. Задача переходит в статус stopped."

    request {
        pathParameter<String>("id") {
            description = "ID задачи"
            required = true
        }
    }

    response {
        code(HttpStatusCode.OK) {
            description = "Задача остановлена"
            body<StopTaskResponse>()
        }
    }
}