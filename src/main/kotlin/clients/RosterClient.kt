package com.viber.clients


interface RosterClient {
    suspend fun getGroup(id: Int): String

    suspend fun getGroupParticipants(id: Int): String

    suspend fun getTask(taskId: String): String

    suspend fun getTaskParticipants(taskId: String): String
}
