package com.viber.bot

object DeviceQueueRouting {
    const val DEFAULT_QUEUE = "viber_commands_queue"
    private val validLegacyId = Regex("^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
    private val validHostLabel = Regex("^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$")

    fun isDefaultDevice(deviceId: String?): Boolean {
        if (deviceId == null) return true
        val normalized = deviceId.trim().lowercase()
        return normalized == "default" ||
                normalized == "android-emulator" ||
                normalized == "emulator-5554" ||
                normalized == "main" ||
                normalized == "worker"
    }

    fun queueName(deviceId: String?, baseQueue: String = DEFAULT_QUEUE): String {
        if (isDefaultDevice(deviceId)) return baseQueue
        require(isValidRoutingId(deviceId!!)) {
            "deviceId must be a safe instance id or hostname:port (maximum 64 characters)"
        }
        return "$baseQueue.device.$deviceId"
    }

    fun validate(deviceId: String?): String? {
        queueName(deviceId)
        return deviceId
    }

    private fun isValidRoutingId(deviceId: String): Boolean {
        if (validLegacyId.matches(deviceId)) return true
        if (deviceId.length > 64) return false

        val separator = deviceId.lastIndexOf(':')
        if (separator <= 0 || separator == deviceId.lastIndex) return false
        val host = deviceId.substring(0, separator)
        val portText = deviceId.substring(separator + 1)
        if (!portText.matches(Regex("^[0-9]{1,5}$"))) return false
        val port = portText.toInt()
        return port in 1..65535 && host.split('.').all(validHostLabel::matches)
    }
}
