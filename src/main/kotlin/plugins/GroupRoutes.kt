package com.viber.plugins

import com.viber.db.DeviceDatabase
import com.viber.db.ViberDatabase
import com.viber.dto.GroupResponse
import com.viber.dto.GroupsResponse
import com.viber.dto.MemberResponse
import com.viber.dto.MembersResponse
import io.ktor.http.HttpStatusCode
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.get
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.slf4j.LoggerFactory

/**
 * Чтение групп из базы устройства.
 *
 * В отличие от `/api/start` и `/api/scroll-members` этот роут отвечает синхронно: запрос
 * к базе — это один короткий запуск adb, а не многоминутная автоматизация UI. Источник данных
 * передаётся параметром, чтобы роут тестировался без устройства.
 */
fun Route.groupRoutes(database: () -> ViberDatabase = { DeviceDatabase.viber }) {
    val logger = LoggerFactory.getLogger("com.viber.plugins.GroupRoutes")

    get("/groups") {
        val groups = try {
            // Запуск adb блокирует поток — уводим с event loop.
            withContext(Dispatchers.IO) { database().groups() }
        } catch (e: Exception) {
            logger.error("Failed to read groups from the device database", e)
            call.respond(
                HttpStatusCode.ServiceUnavailable,
                mapOf("error" to (e.message?.take(300) ?: "Device database is not readable")),
            )
            return@get
        }

        call.respond(
            HttpStatusCode.OK,
            GroupsResponse(
                count = groups.size,
                groups = groups.map {
                    GroupResponse(
                        conversationId = it.conversationId,
                        groupId = it.groupId,
                        name = it.name,
                        conversationType = it.conversationType,
                        memberCount = it.memberCount,
                    )
                },
            ),
        )
    }

    get("/groups/{id}/members") {
        val conversationId = call.parameters["id"]?.toLongOrNull()
        if (conversationId == null) {
            call.respond(HttpStatusCode.BadRequest, mapOf("error" to "Group id must be a number"))
            return@get
        }
        val includeInactive = call.request.queryParameters["includeInactive"].toBoolean()

        val result = try {
            withContext(Dispatchers.IO) {
                val database = database()
                // Отдельный поиск группы: иначе «нет такой группы» неотличимо от «группа пустая».
                database.group(conversationId)?.let { group ->
                    group to database.members(conversationId, includeInactive = includeInactive)
                }
            }
        } catch (e: Exception) {
            logger.error("Failed to read members of $conversationId from the device database", e)
            call.respond(
                HttpStatusCode.ServiceUnavailable,
                mapOf("error" to (e.message?.take(300) ?: "Device database is not readable")),
            )
            return@get
        }

        if (result == null) {
            call.respond(HttpStatusCode.NotFound, mapOf("error" to "No group with conversation id $conversationId"))
            return@get
        }

        val (group, members) = result
        call.respond(
            HttpStatusCode.OK,
            MembersResponse(
                conversationId = group.conversationId,
                groupName = group.name,
                count = members.size,
                members = members.map {
                    MemberResponse(
                        participantId = it.participantId,
                        memberId = it.memberId,
                        encryptedMemberId = it.encryptedMemberId,
                        number = it.number,
                        displayedName = it.displayedName,
                        displayName = it.displayName,
                        contactName = it.contactName,
                        viberName = it.viberName,
                        aliasName = it.aliasName,
                        active = it.active,
                        groupRole = it.groupRole,
                    )
                },
            ),
        )
    }
}
