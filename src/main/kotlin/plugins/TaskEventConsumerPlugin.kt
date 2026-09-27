package com.viber.plugins

import com.viber.infrastructure.rabbitmq.RabbitMqRpcClient
import com.viber.consumers.TaskEventConsumer
import com.viber.bot.ViberBotClient
import com.viber.config.RabbitMqSettings
import com.viber.config.util.ConfigUtil
import com.viber.services.UsersSyncService
import com.viber.services.MonitoredMessagePersistenceService
import com.viber.services.SupabaseMonitoredMessageRepository
import com.viber.supabase.supabaseClient
import io.ktor.server.application.Application
import io.ktor.server.application.ApplicationStopping
import io.ktor.server.application.log

fun Application.configureTaskEventConsumer() {
    val autosync = ConfigUtil(environment.config, "users").bool("autosync") ?: true
    val client = supabaseClient
    if (client == null) {
        log.info("Supabase event persistence is off: Supabase is not configured.")
        return
    }

    val settings = RabbitMqSettings.from(environment.config)
    val rpcClient = if (autosync) RabbitMqRpcClient(settings) else null
    val usersSync = rpcClient?.let {
        UsersSyncService(ViberBotClient(it, settings.queue), supabase = { client })
    }
    val messages = MonitoredMessagePersistenceService(SupabaseMonitoredMessageRepository(client))

    val consumer = TaskEventConsumer(
        settings = settings,
        onReadyTask = { taskId, instanceId ->
            val sync = usersSync ?: return@TaskEventConsumer
            val result = sync.syncTask(taskId, instanceId)
            log.info(
                "Auto-synced task $taskId to Supabase: ${result.usersUpserted} users, " +
                    "${result.deactivated} deactivated (group ${result.group}).",
            )
        },
        onMonitoredMessage = { message -> messages.persist(message) },
    )

    log.info("Task and monitored-message persistence to Supabase started.")

    monitor.subscribe(ApplicationStopping) {
        runCatching { consumer.close() }
        runCatching { rpcClient?.close() }
    }
}
