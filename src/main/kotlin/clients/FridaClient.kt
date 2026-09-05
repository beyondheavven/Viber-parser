package com.viber.clients

import com.viber.config.FridaSettings

class FridaClient(
    private val settings: FridaSettings
) {

    private var device: frida.Device? = null

    fun connect() {
        device = frida.Frida.getDevice(settings.deviceName)
    }

    fun executeScript(script: String): String {
        val session = device?.attach("com.viber.voip") ?: throw IllegalStateException("Frida not connected")
        val compiled = session.createScript(script)
        var result = ""
        compiled.message.connect { message, data ->
            result = message.toString()
        }
        compiled.load()
        return result
    }

}