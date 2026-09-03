package com.viber.supabase

import com.viber.config.SupabaseSettings
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.createSupabaseClient
import io.github.jan.supabase.postgrest.Postgrest
import io.ktor.server.application.Application
import io.ktor.server.application.log


lateinit var supabaseClient: SupabaseClient

fun Application.configureSupabaseClient() {

    val settings = SupabaseSettings.from(environment.config)

    supabaseClient = createSupabaseClient(
        supabaseUrl = settings.url,
        supabaseKey = settings.key
    ){
        install(Postgrest)
    }

    log.info("Supabase client initialized: ${settings.describe()}")

}