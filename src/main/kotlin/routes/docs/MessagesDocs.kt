package com.viber.routes.docs

import com.viber.models.EnableMonitorGroupRequest
import com.viber.models.MonitorStatus
import com.viber.models.MonitoredGroup
import com.viber.models.StartMonitorRequest
import io.github.smiley4.ktoropenapi.config.RouteConfig
import io.ktor.http.HttpStatusCode

val describeStartMonitor: RouteConfig.() -> Unit = {
    operationId = "startMonitor"
    tags = listOf("Messages")
    summary = "Запустить мониторинг сообщений"
    description = "Запускает фоновый мониторинг включённых групп. Сообщения ловятся " +
            "мгновенно через Frida-хук записи в SQLite, опрос БД — как страховочный резервный путь."

    request {
        body<StartMonitorRequest> {
            description = "Опционально: группа для немедленного включения и параметры опроса"
            required = false
        }
    }

    response {
        code(HttpStatusCode.OK) {
            description = "Мониторинг запущен"
            body<MonitorStatus>()
        }
    }
}

val describeStopMonitor: RouteConfig.() -> Unit = {
    operationId = "stopMonitor"
    tags = listOf("Messages")
    summary = "Остановить мониторинг сообщений"
    description = "Останавливает фоновый опрос. Курсоры групп (lastMessageId) сохраняются " +
            "для последующего продолжения без потери истории."

    response {
        code(HttpStatusCode.OK) {
            description = "Мониторинг остановлен"
            body<MonitorStatus>()
        }
    }
}

val describeGetMonitorStatus: RouteConfig.() -> Unit = {
    operationId = "getMonitorStatus"
    tags = listOf("Messages")
    summary = "Получить статус мониторинга"
    description = "Возвращает текущее состояние монитора: запущен ли, список групп, " +
            "счётчики обработанных сообщений и извлечённых телефонов."

    response {
        code(HttpStatusCode.OK) {
            description = "Текущий статус"
            body<MonitorStatus>()
        }
    }
}

val describeGetMonitoredGroups: RouteConfig.() -> Unit = {
    operationId = "getMonitoredGroups"
    tags = listOf("Messages")
    summary = "Список групп на мониторинге"
    description = "Возвращает группы с флагом enabled и текущим курсором catch-up " +
            "(lastMessageId) для каждой."

    response {
        code(HttpStatusCode.OK) {
            description = "Список групп"
            body<List<MonitoredGroup>>()
        }
    }
}

val describeEnableMonitorGroup: RouteConfig.() -> Unit = {
    operationId = "enableMonitorGroup"
    tags = listOf("Messages")
    summary = "Включить мониторинг группы"
    description = "Включает мониторинг конкретной группы по её ID. После рестарта эмулятора " +
            "сообщения догоняются с сохранённого курсора, если fromLatest не указан явно."

    request {
        pathParameter<Int>("id") {
            description = "ID беседы (row ID)"
            required = true
        }
        body<EnableMonitorGroupRequest> {
            description = "Опционально: пропустить историю (fromLatest)"
            required = false
        }
    }

    response {
        code(HttpStatusCode.OK) {
            description = "Группа включена в мониторинг"
            body<MonitorStatus>()
        }
        code(HttpStatusCode.NotFound) {
            description = "Группа не найдена"
        }
    }
}

val describeDisableMonitorGroup: RouteConfig.() -> Unit = {
    operationId = "disableMonitorGroup"
    tags = listOf("Messages")
    summary = "Выключить мониторинг группы"
    description = "Выключает мониторинг группы. Курсор сохраняется для следующего включения."

    request {
        pathParameter<Int>("id") {
            description = "ID беседы (row ID)"
            required = true
        }
    }

    response {
        code(HttpStatusCode.OK) {
            description = "Группа выключена из мониторинга"
            body<MonitorStatus>()
        }
        code(HttpStatusCode.NotFound) {
            description = "Группа не стоит на мониторинге"
        }
    }
}