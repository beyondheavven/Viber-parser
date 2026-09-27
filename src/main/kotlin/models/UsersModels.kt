package com.viber.models

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class ViberUserRow(
    val id: Long? = null,

    @SerialName("identity_key")
    val identityKey: String,

    @SerialName("member_id")
    val memberId: String? = null,

    val phone: String? = null,

    val name: String? = null,

    @SerialName("viber_name")
    val viberName: String? = null,

    @SerialName("is_online")
    val isOnline: Boolean? = null,

    @SerialName("last_seen_at")
    val lastSeenAt: String? = null,

    @SerialName("first_seen_at")
    val firstSeenAt: String? = null,

    @SerialName("updated_at")
    val updatedAt: String? = null,
)

@Serializable
data class ViberGroupRow(
    val id: Long? = null,

    @SerialName("instance_id")
    val instanceId: String = "default",

    @SerialName("group_key")
    val groupKey: String,

    @SerialName("viber_group_id")
    val viberGroupId: String? = null,

    @SerialName("conversation_id")
    val conversationId: Int? = null,

    val name: String? = null,

    @SerialName("participant_count")
    val participantCount: Int,

    @SerialName("last_synced_at")
    val lastSyncedAt: String? = null,

    @SerialName("updated_at")
    val updatedAt: String? = null,
)

@Serializable
data class ViberGroupMemberRow(
    @SerialName("group_id")
    val groupId: Long,

    @SerialName("user_id")
    val userId: Long,

    val role: Int? = null,

    val active: Boolean,

    @SerialName("synced_at")
    val syncedAt: String,
)

@Serializable
data class UsersSyncResult(
    val success: Boolean,

    val message: String,

    val group: String? = null,

    val conversationId: Int? = null,

    val groupId: String? = null,

    val received: Int,

    val usersUpserted: Int,

    val skipped: Int,

    val deactivated: Int,

    val syncedAt: String,
)

@Serializable
data class UsersSyncFailure(
    val conversationId: Int,

    val group: String? = null,

    val error: String,
)

@Serializable
data class UsersSyncAllResult(
    val success: Boolean,

    val message: String,

    val groupsTotal: Int,

    val groups: List<UsersSyncResult>,

    val failed: List<UsersSyncFailure>,

    val usersUpserted: Int,

    val usersInDatabase: Int? = null,

    val syncedAt: String,
)

@Serializable
data class GroupSyncStatus(
    val groupKey: String,

    val conversationId: Int? = null,

    val name: String? = null,

    val participantCount: Int,

    val activeMembers: Int? = null,

    val inactiveMembers: Int? = null,

    val lastSyncedAt: String? = null,
)

@Serializable
data class UsersSyncStatus(
    val configured: Boolean,

    val reachable: Boolean,

    val message: String,

    val usersTotal: Int? = null,

    val groupsTotal: Int? = null,

    val membersTotal: Int? = null,

    val lastSyncedAt: String? = null,

    val groups: List<GroupSyncStatus> = emptyList(),

    val checkedAt: String,
)

@Serializable
data class UsersPage(
    val total: Int? = null,

    val limit: Int,

    val offset: Int,

    val items: List<ViberUserRow>,
)
