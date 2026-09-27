package com.viber.services

import com.viber.models.MonitoredExportEnvelope
import com.viber.models.MonitoredMessageResponse
import com.viber.models.SupabaseMonitoredMessageWithGroup
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.query.Columns
import io.github.jan.supabase.postgrest.query.Order
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import org.slf4j.LoggerFactory
import java.time.Instant

data class ExportResult(
    val filename: String,
    val contentType: String,
    val content: String,
)

interface MonitoredMessageQueryRepository {
    suspend fun listMessages(
        deviceId: String? = null,
        conversationId: Int? = null,
        hasPhone: Boolean? = null,
        phoneSource: String? = null,
        limit: Int = 2000,
        offset: Int = 0,
    ): List<MonitoredMessageResponse>
}

class SupabaseMonitoredMessageQueryRepository(
    private val client: SupabaseClient,
) : MonitoredMessageQueryRepository {
    private val logger = LoggerFactory.getLogger(SupabaseMonitoredMessageQueryRepository::class.java)

    override suspend fun listMessages(
        deviceId: String?,
        conversationId: Int?,
        hasPhone: Boolean?,
        phoneSource: String?,
        limit: Int,
        offset: Int,
    ): List<MonitoredMessageResponse> {
        val targetInstance = deviceId?.trim()?.takeIf { it.isNotEmpty() && it != "all" }
        val targetSource = phoneSource?.trim()?.takeIf { it.isNotEmpty() && it != "all" }

        val query = client.from("viber_monitored_messages").select(
            Columns.raw(
                """
                id,
                group_id,
                instance_id,
                conversation_id,
                source_key,
                source_message_id,
                viber_token,
                sender_name,
                sent_at,
                phone,
                phone_source,
                content,
                created_at,
                updated_at,
                viber_groups(name, group_key)
                """.trimIndent()
            )
        ) {
            filter {
                if (targetInstance != null) {
                    if (com.viber.bot.DeviceQueueRouting.isDefaultDevice(targetInstance)) {
                        or {
                            eq("instance_id", "default")
                            eq("instance_id", targetInstance)
                            eq("instance_id", "worker")
                            eq("instance_id", "android-emulator")
                        }
                    } else {
                        eq("instance_id", targetInstance)
                    }
                }
                if (conversationId != null) {
                    eq("conversation_id", conversationId)
                }
                if (hasPhone == true) {
                    neq("phone_source", "none")
                } else if (hasPhone == false) {
                    eq("phone_source", "none")
                }
                if (targetSource != null) {
                    eq("phone_source", targetSource)
                }
            }
            order("sent_at", Order.DESCENDING)
            if (limit > 0) {
                limit(limit.toLong())
            }
            if (offset > 0) {
                range(offset.toLong(), (offset + (if (limit > 0) limit else 2000) - 1).toLong())
            }
        }

        val rows = query.decodeList<SupabaseMonitoredMessageWithGroup>()
        return rows.map { it.toResponse(targetInstance) }
    }
}

class MonitoredMessageQueryService(
    private val supabase: () -> SupabaseClient? = { null },
    private val repositoryProvider: (SupabaseClient) -> MonitoredMessageQueryRepository = {
        SupabaseMonitoredMessageQueryRepository(it)
    },
    private val repository: MonitoredMessageQueryRepository? = null,
    private val now: () -> Instant = { Instant.now() },
) {
    private val logger = LoggerFactory.getLogger(MonitoredMessageQueryService::class.java)
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }
    private val prettyJson = Json { ignoreUnknownKeys = true; encodeDefaults = true; prettyPrint = true }

    suspend fun listMessages(
        deviceId: String? = null,
        conversationId: Int? = null,
        hasPhone: Boolean? = null,
        phoneSource: String? = null,
        limit: Int = 2000,
        offset: Int = 0,
    ): List<MonitoredMessageResponse> {
        val repo = repository ?: run {
            val client = supabase() ?: run {
                logger.warn("Supabase client is not configured; returning empty monitored messages list")
                return emptyList()
            }
            repositoryProvider(client)
        }
        return try {
            repo.listMessages(
                deviceId = deviceId,
                conversationId = conversationId,
                hasPhone = hasPhone,
                phoneSource = phoneSource,
                limit = limit,
                offset = offset,
            )
        } catch (e: Exception) {
            logger.error("Failed to query monitored messages from Supabase: {}", e.message, e)
            emptyList()
        }
    }

    suspend fun exportMessages(
        format: String,
        deviceId: String? = null,
        conversationId: Int? = null,
        hasPhone: Boolean? = null,
        phoneSource: String? = null,
        limit: Int = 0,
    ): ExportResult {
        val messages = listMessages(
            deviceId = deviceId,
            conversationId = conversationId,
            hasPhone = hasPhone,
            phoneSource = phoneSource,
            limit = limit,
            offset = 0,
        )
        val exportedAt = now()
        val stamp = exportedAt.toString().replace(":", "-").replace(".", "-")

        return when (format.lowercase()) {
            "csv" -> {
                val csvContent = buildCsv(messages)
                ExportResult(
                    filename = "monitored-messages-$stamp.csv",
                    contentType = "text/csv; charset=utf-8",
                    content = "\uFEFF$csvContent",
                )
            }
            "jsonl" -> {
                val lines = messages.joinToString("\n") { json.encodeToString(it) }
                ExportResult(
                    filename = "monitored-messages-$stamp.jsonl",
                    contentType = "application/x-ndjson; charset=utf-8",
                    content = if (lines.isNotEmpty()) "$lines\n" else "",
                )
            }
            else -> {
                val body = prettyJson.encodeToString(
                    MonitoredExportEnvelope(
                        exportedAt = exportedAt.toString(),
                        count = messages.size,
                        messages = messages,
                    )
                )
                ExportResult(
                    filename = "monitored-messages-$stamp.json",
                    contentType = "application/json; charset=utf-8",
                    content = "$body\n",
                )
            }
        }
    }

    private fun buildCsv(messages: List<MonitoredMessageResponse>): String {
        val headers = listOf(
            "id",
            "date",
            "conversationId",
            "conversationName",
            "senderName",
            "senderMemberId",
            "body",
            "attachedPhone",
            "phoneSource",
            "hasPhoneInText",
            "hasMedia",
            "mediaUris",
            "outgoing"
        )
        val rows = messages.map { m ->
            listOf(
                m.id.toString(),
                m.date,
                m.conversationId.toString(),
                m.conversationName.orEmpty(),
                m.senderName.orEmpty(),
                m.senderMemberId.orEmpty(),
                m.body.orEmpty(),
                m.attachedPhone.orEmpty(),
                m.phoneSource,
                m.hasPhoneInText.toString(),
                m.hasMedia.toString(),
                (m.mediaUris ?: emptyList()).joinToString(" | "),
                m.outgoing.toString(),
            ).joinToString(",") { escapeCsvCell(it) }
        }
        return (listOf(headers.joinToString(",")) + rows).joinToString("\r\n")
    }

    private fun escapeCsvCell(value: String): String {
        if (value.contains(',') || value.contains('"') || value.contains('\n') || value.contains('\r') || value.contains(';')) {
            return "\"${value.replace("\"", "\"\"")}\""
        }
        return value
    }
}
