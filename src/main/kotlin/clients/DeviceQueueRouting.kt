package com.viber.clients

object DeviceQueueRouting {
    const val DEFAULT_QUEUE = "viber_commands_queue"
    private val validDeviceId = Regex("^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")

    fun queueName(deviceId: String?, baseQueue: String = DEFAULT_QUEUE): String {
        if (deviceId == null) return baseQueue
        require(validDeviceId.matches(deviceId)) {
            "deviceId must contain 1-64 alphanumeric, '-' or '_' characters"
        }
        return "$baseQueue.device.$deviceId"
    }

    fun validate(deviceId: String?): String? {
        queueName(deviceId)
        return deviceId
    }
}
