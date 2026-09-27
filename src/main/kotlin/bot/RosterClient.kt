package com.viber.bot


interface RosterClient {
    suspend fun getGroups(includeAll: Boolean = false): String

    suspend fun getGroup(id: Int): String

    suspend fun getGroupParticipants(id: Int): String

    suspend fun getTask(taskId: String): String

    suspend fun getTaskParticipants(taskId: String): String
}
