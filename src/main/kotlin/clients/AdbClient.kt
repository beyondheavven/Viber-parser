package com.viber.clients

import com.viber.config.AdbSettings
import com.viber.models.ViberAccountInfo

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

    fun getPid(packageName: String): Int? {
        val output = exec("shell pidof $packageName").trim()
        return output.toIntOrNull()
    }

    fun getAccountInfo(): ViberAccountInfo {
        return try {
            val rawPhone = exec("shell strings /data/data/com.viber.voip/files/preferences/reg_viber_phone_num_canonized").trim()
            val phoneMatch = Regex("""\d{7,15}""").find(rawPhone)?.value
            val formattedPhone = phoneMatch?.let { if (it.startsWith("+")) it else "+$it" }

            val xml = exec("shell cat /data/data/com.viber.voip/shared_prefs/com.viber.voip.ViberPrefs.xml 2>/dev/null")
            val displayName = Regex("""<string name="display_name">(.*?)</string>""").find(xml)?.groupValues?.get(1)?.trim()

            val isAuthorized = formattedPhone != null

            ViberAccountInfo(
                phoneNumber = formattedPhone,
                displayName = displayName,
                isAuthorized = isAuthorized,
            )
        } catch (e: Exception) {
            ViberAccountInfo(
                phoneNumber = null,
                displayName = null,
                isAuthorized = false,
            )
        }
    }

}