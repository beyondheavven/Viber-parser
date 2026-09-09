package com.viber.config

import com.viber.config.util.ConfigUtil
import io.ktor.server.config.ApplicationConfig
import java.time.Duration

class RabbitMqSettings(config: ConfigUtil) {
    val host: String = config.requireText("host")

    val port: Int = config.int("port") ?: 5672

    val user: String = config.requireText("user")

    val pass: String = config.requireText("password")

    val queue: String = config.text("queue") ?: "viber_commands_queue"

    val timeout: Duration = config.seconds("timeoutSeconds") ?: Duration.ofSeconds(60)

    companion object {
        fun from(config: ApplicationConfig): RabbitMqSettings {
            return RabbitMqSettings(ConfigUtil(config, "rabbitmq"))
        }
    }
}
