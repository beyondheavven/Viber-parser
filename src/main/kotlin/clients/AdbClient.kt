package com.viber.clients

import com.viber.config.AdbSettings

class AdbClient(
    private val settings: AdbSettings
) {

    init{
        connect()
    }

    private fun connect() {
        repeat(settings.connectRetries) { attempt ->
            val result = exec("connect ${settings.host}:${settings.port}")
            if (result.contains("connected")) return
            Thread.sleep(2000)
        }
        throw IllegalStateException("Failed to connect to ADB after ${settings.connectRetries} attempts")
    }

    fun exec(command: String): String {
        val fullCommand = "adb $command"
        val process = ProcessBuilder("sh", "-c", fullCommand)
            .redirectErrorStream(true)
            .start()
        val output = process.inputStream.bufferedReader().readText()
        process.waitFor()
        return output
    }

    fun startApp(packageName: String, activity: String) {
        exec("shell am start -n $packageName/$activity")
    }

    fun clearApp(packageName: String) {
        exec("shell pm clear $packageName")
    }

    fun isAppRunning(packageName: String): Boolean {
        return exec("shell pidof $packageName").isNotBlank()
    }

    fun isAppForeground(packageName: String): Boolean {
        val output = exec("shell dumpsys activity activities | grep mResumedActivity")
        return output.contains(packageName)
    }

}