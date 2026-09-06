package com.viber.models

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

@Serializable
data class TaskSummary(
    val id: String,

    val groupTarget: String,

    val groupName: String? = null,

    val conversationId: Int? = null,

    val status: String,

    val currentStep: TaskStep? = null,

    val createdAt: String,

    val startedAt: String? = null,

    val completedAt: String? = null
)

@Serializable
data class TaskStep(
    val step: String,

    val description: String,

    val startedAt: String,

    val durationMs: Int? = null,

    val progress: JsonElement? = null
)


@Serializable
data class TaskCreatedResponse(

    val taskId: String,

    val status: String,

    val group: String,

    val message: String

)

@Serializable
data class StopTaskResponse(
    val taskId: String,

    val status: String,

    val message: String
)