package com.viber.supabase

import com.viber.config.SupabaseSettings
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.createSupabaseClient
import io.github.jan.supabase.postgrest.Postgrest
import io.ktor.server.application.Application
import io.ktor.server.application.ApplicationStopping
import io.ktor.server.application.log
import kotlinx.coroutines.runBlocking


@Volatile
var supabaseClient: SupabaseClient? = null
    private set

fun Application.configureSupabaseClient() {

    val settings = SupabaseSettings.from(environment.config)

    if (settings == null) {
        supabaseClient = null
        log.info("Supabase is disabled: SUPABASE_URL and SUPABASE_KEY are not set")
        return
    }

    supabaseClient = createSupabaseClient(
        supabaseUrl = settings.url,
        supabaseKey = settings.key
    ){
        install(Postgrest)
    }

    log.info("Supabase client initialized: ${settings.describe()}")

    monitor.subscribe(ApplicationStopping) {
        try {
            runBlocking { supabaseClient?.close() }
        } catch (e: Exception) {
            log.warn("Failed to close Supabase client on shutdown", e)
        }
        supabaseClient = null
    }

}
