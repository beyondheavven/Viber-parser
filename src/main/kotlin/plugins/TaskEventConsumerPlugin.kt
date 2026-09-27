package com.viber.plugins

import com.viber.clients.RabbitMqRpcClient
import com.viber.clients.TaskEventConsumer
import com.viber.clients.ViberBotClient
import com.viber.config.RabbitMqSettings
import com.viber.config.util.ConfigUtil
import com.viber.services.UsersSyncService
import com.viber.supabase.supabaseClient
import io.ktor.server.application.Application
import io.ktor.server.application.ApplicationStopping
import io.ktor.server.application.log

fun Application.configureTaskEventConsumer() {
    val autosync = ConfigUtil(environment.config, "users").bool("autosync") ?: true
    if (!autosync) {
        log.info("Users auto-sync disabled (users.autosync=false).")
        return
    }
    if (supabaseClient == null) {
        log.info("Users auto-sync off: Supabase is not configured.")
        return
    }

    val settings = RabbitMqSettings.from(environment.config)
    val rpcClient = RabbitMqRpcClient(settings)
    val usersSync = UsersSyncService(ViberBotClient(rpcClient)) { supabaseClient }

    val consumer = TaskEventConsumer(settings) { taskId ->
        val result = usersSync.syncTask(taskId)
        log.info(
            "Auto-synced task $taskId to Supabase: ${result.usersUpserted} users, " +
                "${result.deactivated} deactivated (group ${result.group}).",
        )
    }

    log.info("Task-event auto-sync to Supabase started.")

    monitor.subscribe(ApplicationStopping) {
        runCatching { consumer.close() }
        runCatching { rpcClient.close() }
    }
}
