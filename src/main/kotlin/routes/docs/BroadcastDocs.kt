package com.viber.routes.docs

import com.viber.models.BroadcastStatus
import com.viber.models.Campaign
import com.viber.models.CampaignDeletedResponse
import com.viber.models.CreateCampaignRequest
import com.viber.models.SendHistoryEntry
import com.viber.models.UpdateCampaignRequest
import io.github.smiley4.ktoropenapi.config.RouteConfig
import io.ktor.http.HttpStatusCode

private const val BROADCAST_TAG = "Broadcast"

val describeBroadcastStatus: RouteConfig.() -> Unit = {
    operationId = "getBroadcastStatus"
    tags = listOf(BROADCAST_TAG)
    summary = "Текущая запущенная кампания рассылки"
    description = "Одновременно рассылает не больше одной кампании — эмулятор один."

    request {
        queryParameter<String>("deviceId") { description = "ID экземпляра эмулятора" }
    }

    response {
        code(HttpStatusCode.OK) {
            description = "Статус рассылки"
            body<BroadcastStatus>()
        }
    }
}

val describeBroadcastHistory: RouteConfig.() -> Unit = {
    operationId = "getBroadcastHistory"
    tags = listOf(BROADCAST_TAG)
    summary = "История отправок"
    description = "Попытки отправки, новые сверху. Неудачные попытки тоже сохраняются — с текстом ошибки."

    request {
        queryParameter<String>("deviceId") { description = "ID экземпляра эмулятора" }
        queryParameter<Int>("conversationId") { description = "Оставить только отправки в эту беседу" }
        queryParameter<String>("campaignId") { description = "Оставить только отправки этой кампании" }
        queryParameter<Int>("limit") { description = "Сколько записей вернуть, по умолчанию 100" }
    }

    response {
        code(HttpStatusCode.OK) {
            description = "Записи истории"
            body<List<SendHistoryEntry>>()
        }
    }
}

val describeBroadcastLastSends: RouteConfig.() -> Unit = {
    operationId = "getBroadcastLastSends"
    tags = listOf(BROADCAST_TAG)
    summary = "Последняя отправка в каждую беседу"
    description = "По одной записи на беседу: какая кампания, какой текст и когда отправила последней."

    request {
        queryParameter<String>("deviceId") { description = "ID экземпляра эмулятора" }
    }

    response {
        code(HttpStatusCode.OK) {
            description = "Последние отправки"
            body<List<SendHistoryEntry>>()
        }
    }
}

val describeListCampaigns: RouteConfig.() -> Unit = {
    operationId = "listCampaigns"
    tags = listOf(BROADCAST_TAG)
    summary = "Список кампаний рассылки"

    request {
        queryParameter<String>("deviceId") { description = "ID экземпляра эмулятора" }
    }

    response {
        code(HttpStatusCode.OK) {
            description = "Кампании, новые сверху"
            body<List<Campaign>>()
        }
    }
}

val describeGetCampaign: RouteConfig.() -> Unit = {
    operationId = "getCampaign"
    tags = listOf(BROADCAST_TAG)
    summary = "Кампания по ID"

    request {
        queryParameter<String>("deviceId") { description = "ID экземпляра эмулятора" }
        pathParameter<String>("id") { description = "ID кампании" }
    }

    response {
        code(HttpStatusCode.OK) {
            description = "Кампания"
            body<Campaign>()
        }
        code(HttpStatusCode.NotFound) { description = "Кампания не найдена" }
    }
}

val describeCreateCampaign: RouteConfig.() -> Unit = {
    operationId = "createCampaign"
    tags = listOf(BROADCAST_TAG)
    summary = "Создать кампанию рассылки"
    description = "Кампания создаётся остановленной. Рассылка начнётся только после вызова /start."

    request {
        queryParameter<String>("deviceId") { description = "ID экземпляра эмулятора" }
        body<CreateCampaignRequest> {
            description = "Беседы, варианты текста и расписание"
            required = true
        }
    }

    response {
        code(HttpStatusCode.Created) {
            description = "Кампания создана"
            body<Campaign>()
        }
        code(HttpStatusCode.BadRequest) { description = "Пустой список текстов или интервал меньше 5 секунд" }
    }
}

val describeUpdateCampaign: RouteConfig.() -> Unit = {
    operationId = "updateCampaign"
    tags = listOf(BROADCAST_TAG)
    summary = "Изменить кампанию"
    description = "Менять можно только остановленную кампанию. Переданы будут лишь указанные поля."

    request {
        queryParameter<String>("deviceId") { description = "ID экземпляра эмулятора" }
        pathParameter<String>("id") { description = "ID кампании" }
        body<UpdateCampaignRequest> {
            description = "Поля, которые нужно изменить"
            required = true
        }
    }

    response {
        code(HttpStatusCode.OK) {
            description = "Кампания обновлена"
            body<Campaign>()
        }
        code(HttpStatusCode.Conflict) { description = "Кампания запущена" }
        code(HttpStatusCode.NotFound) { description = "Кампания не найдена" }
    }
}

val describeDeleteCampaign: RouteConfig.() -> Unit = {
    operationId = "deleteCampaign"
    tags = listOf(BROADCAST_TAG)
    summary = "Удалить кампанию"
    description = "История отправок удалённой кампании сохраняется."

    request {
        queryParameter<String>("deviceId") { description = "ID экземпляра эмулятора" }
        pathParameter<String>("id") { description = "ID кампании" }
    }

    response {
        code(HttpStatusCode.OK) {
            description = "Кампания удалена"
            body<CampaignDeletedResponse>()
        }
        code(HttpStatusCode.Conflict) { description = "Кампания запущена" }
        code(HttpStatusCode.NotFound) { description = "Кампания не найдена" }
    }
}

val describeStartCampaign: RouteConfig.() -> Unit = {
    operationId = "startCampaign"
    tags = listOf(BROADCAST_TAG)
    summary = "Запустить рассылку"
    description = "Пауза между отправками — intervalMs, вариант текста выбирается стратегией rotation. " +
            "Если заданы рабочие часы, вне окна рассылка ждёт."

    request {
        queryParameter<String>("deviceId") { description = "ID экземпляра эмулятора" }
        pathParameter<String>("id") { description = "ID кампании" }
    }

    response {
        code(HttpStatusCode.OK) {
            description = "Рассылка запущена"
            body<Campaign>()
        }
        code(HttpStatusCode.Conflict) { description = "Другая кампания уже рассылает" }
        code(HttpStatusCode.BadRequest) { description = "У выбранной беседы нет названия — её нельзя открыть в списке чатов" }
    }
}

val describeStopCampaign: RouteConfig.() -> Unit = {
    operationId = "stopCampaign"
    tags = listOf(BROADCAST_TAG)
    summary = "Остановить рассылку"
    description = "Текущая отправка досылается, следующая не начинается. История сохраняется."

    request {
        queryParameter<String>("deviceId") { description = "ID экземпляра эмулятора" }
        pathParameter<String>("id") { description = "ID кампании" }
    }

    response {
        code(HttpStatusCode.OK) {
            description = "Рассылка остановлена"
            body<Campaign>()
        }
        code(HttpStatusCode.NotFound) { description = "Кампания не найдена" }
    }
}
