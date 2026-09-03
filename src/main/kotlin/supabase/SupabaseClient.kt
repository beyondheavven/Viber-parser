package com.viber.supabase

import io.github.jan.supabase.SupabaseClient
import io.ktor.server.application.Application


lateinit var supabaseClient: SupabaseClient

fun Application.configureDatabase() {

    val dbUrl =
}