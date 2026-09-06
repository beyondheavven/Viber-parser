package com.viber.clients

import com.viber.config.FridaSettings
import com.viber.models.FridaBridgeResult
import kotlinx.serialization.json.Json
import java.io.File

class FridaClient(

    private val settings: FridaSettings

) {

    private val json = Json { ignoreUnknownKeys = true }

    fun executeScript(script: String, packageName: String = "com.viber.voip"): FridaBridgeResult {
        return try {
            val process = ProcessBuilder(
                "python3",
                settings.bridgeScriptPath,
                settings.host,
                settings.port.toString(),
                packageName
            ).start()

            process.outputStream.bufferedWriter().use { writer ->
                writer.write(script)
            }

            val stdout = process.inputStream.bufferedReader().readText()

            val stderr = process.errorStream.bufferedReader().readText()

            if (stderr.isNotBlank()) {
                println("Frida bridge stderr: $stderr")
            }

            if (stdout.isBlank()) {
                FridaBridgeResult(success = false, error = "Пустой ответ от бриджа. stderr: $stderr")
            } else {
                json.decodeFromString<FridaBridgeResult>(stdout.trim())
            }
        } catch (e: Exception) {
            FridaBridgeResult(success = false, error = e.message)
        }
    }

    fun enterPhoneNumber(phoneNumber: String): FridaBridgeResult {
        val script = """
            Java.perform(function() {
                var EditText = Java.use('android.widget.EditText');
                Java.choose('android.widget.EditText', {
                    onMatch: function(instance) {
                        instance.setText("$phoneNumber");
                    },
                    onComplete: function() {}
                });
            });
        """.trimIndent()
        return executeScript(script)
    }

    fun enterCode(code: String): FridaBridgeResult {
        val script = """
            Java.perform(function() {
                var EditText = Java.use('android.widget.EditText');
                Java.choose('android.widget.EditText', {
                    onMatch: function(instance) {
                        instance.setText("$code");
                        instance.performClick();
                    },
                    onComplete: function() {}
                });
            });
        """.trimIndent()
        return executeScript(script)
    }

    fun clickButton(text: String): FridaBridgeResult {
        val script = """
            Java.perform(function() {
                Java.choose('android.widget.Button', {
                    onMatch: function(button) {
                        if (button.getText().toString() === "$text") {
                            button.performClick();
                        }
                    },
                    onComplete: function() {}
                });
            });
        """.trimIndent()
        return executeScript(script)
    }

}