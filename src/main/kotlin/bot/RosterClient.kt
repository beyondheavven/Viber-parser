package com.viber.bot

interface RosterClient {
    suspend fun getGroups(includeAll: Boolean = false): String
    suspend fun getGroups(includeAll: Boolean, deviceId: String?): String = getGroups(includeAll)

    suspend fun getGroup(id: Int): String
    suspend fun getGroup(id: Int, deviceId: String?): String = getGroup(id)

    suspend fun getGroupParticipants(id: Int): String
    suspend fun getGroupParticipants(id: Int, deviceId: String?): String = getGroupParticipants(id)

    suspend fun getTask(taskId: String): String
    suspend fun getTask(taskId: String, deviceId: String?): String = getTask(taskId)

    suspend fun getTaskParticipants(taskId: String): String
    suspend fun getTaskParticipants(taskId: String, deviceId: String?): String = getTaskParticipants(taskId)
}
