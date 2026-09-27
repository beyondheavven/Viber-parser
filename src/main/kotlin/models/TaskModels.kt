package com.viber.models

import kotlinx.serialization.Serializable

@Serializable
data class TaskSummary(
    val id: String,

    val groupTarget: String,

    val groupName: String? = null,

    val conversationId: Int? = null,

    val status: String,

    val participantsCount: Int? = null,

    val currentStep: TaskStep? = null,

    val createdAt: String,

    val startedAt: String? = null,

    val completedAt: String? = null,

    val error: String? = null,
)

@Serializable
data class TaskStep(
    val step: String,

    val description: String,

    val startedAt: String,

    val durationMs: Int? = null,

    val progress: Map<String, String>? = null
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

@Serializable
data class TaskCollectionResult(
    val group: String,

    val conversationId: Int,

    val groupId: String,

    val headerTotal: Int? = null,

    val pagesCount: Int,

    val participantsCount: Int,

    val participantsWithPhone: Int,

    val savedJsonPath: String,

    val savedTxtPath: String,

    val savedCsvPath: String
)


@Serializable
data class TaskDetail(
    val id: String,

    val groupTarget: String,

    val groupName: String? = null,

    val conversationId: Int? = null,

    val status: String,

    val currentStep: TaskStep? = null,

    val createdAt: String,

    val startedAt: String? = null,

    val completedAt: String? = null,

    val stepHistory: List<TaskStep> = emptyList(),

    val progress: Map<String, String>? = null,

    val error: String? = null,

    val result: TaskCollectionResult? = null
)

@Serializable
data class TaskSyncView(
    val status: String,
    val result: TaskCollectionResult? = null,
)