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

/** Row of `public.viber_groups` in Supabase. */
@Serializable
data class ViberGroupRow(
    val id: Long? = null,

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

/** Row of `public.viber_group_members` in Supabase. */
@Serializable
data class ViberGroupMemberRow(
    @SerialName("group_id")
    val groupId: Long,

    @SerialName("user_id")
    val userId: Long,

    val role: Int? = null,

    val active: Boolean = true,

    @SerialName("synced_at")
    val syncedAt: String,
)

/** What a sync of one group into Supabase did. */
@Serializable
data class UsersSyncResult(
    val success: Boolean,

    val message: String,

    val group: String? = null,

    val conversationId: Int? = null,

    val groupId: String? = null,

    /** Participants received from the bot, before filtering. */
    val received: Int,

    /** Rows written to `viber_users` (inserted or updated). */
    val usersUpserted: Int,

    /** Participants skipped: the account itself, duplicates, or no member id and no phone. */
    val skipped: Int,

    /** Members of the group marked inactive because the sync no longer lists them. */
    val deactivated: Int,

    val syncedAt: String,
)

/** Page of users read back from Supabase. */
@Serializable
data class UsersPage(
    val total: Int? = null,

    val limit: Int,

    val offset: Int,

    val items: List<ViberUserRow>,
)
