package com.viber.db

/** Беседа-группа из `conversations`. */
data class ViberGroup(
    val conversationId: Long,
    val groupId: Long,
    val name: String?,
    val conversationType: Int,
    val memberCount: Int,
)

/** Участник группы: строка `participants`, склеенная с карточкой из `participants_info`. */
data class ViberMember(
    val participantId: Long,
    val infoId: Long,
    val memberId: String?,
    val encryptedMemberId: String?,
    val number: String?,
    val displayName: String?,
    val contactName: String?,
    val viberName: String?,
    val aliasName: String?,
    val active: Boolean,
    val groupRole: Int,
) {
    /**
     * То, что видно в списке участников: имя, заданное внутри группы, затем готовый
     * display_name от Viber, затем что осталось. Номер — последний рубеж, он есть не всегда.
     */
    val displayedName: String?
        get() = sequenceOf(aliasName, displayName, contactName, viberName, number)
            .firstOrNull { !it.isNullOrBlank() }
}

/**
 * Типизированные выборки поверх `viber_messages`.
 *
 * Значения подставляются в SQL текстом (устройский sqlite3 гоняем как CLI, плейсхолдеров
 * там нет), поэтому строки обязаны проходить через [quote] — см. тест про имя с кавычкой.
 *
 * Дедупликация. Viber держит одного человека двумя карточками в `participants_info`:
 * `participant_type = 1` с настоящим номером и `participant_type = 2`, где вместо номера
 * лежит зашифрованное значение. Обе попадают в `participants`, поэтому список участников
 * без склейки задваивается (в живой группе 53 строки против 38 человек). Ключ склейки —
 * `encrypted_member_id`: он одинаков у обеих карточек и заполнен там, где `member_id`
 * может быть подменён тем же зашифрованным значением. Победителем берём карточку с
 * настоящим телефоном. Оконных функций в sqlite 3.22 на устройстве нет, поэтому склейка
 * держится на `max()` + bare columns: sqlite отдаёт остальные колонки из той строки, где
 * достигнут максимум.
 */
class ViberDatabase(private val executor: SqlExecutor) {

    fun groups(): List<ViberGroup> = groupsWhere("c.group_id != 0 and c.deleted = 0")

    /** Одна группа по id беседы — нужен, чтобы отличать «нет такой группы» от «группа пустая». */
    fun group(conversationId: Long): ViberGroup? =
        groupsWhere("c._id = $conversationId and c.group_id != 0 and c.deleted = 0").firstOrNull()

    private fun groupsWhere(condition: String): List<ViberGroup> = executor.query(
        """
        select c._id as _id,
               c.group_id as group_id,
               c.name as name,
               c.conversation_type as conversation_type,
               (select count(distinct coalesce(nullif(i.encrypted_member_id, ''), i.member_id, 'row' || i._id))
                from participants p
                join participants_info i on i._id = p.participant_info_id
                where p.conversation_id = c._id and p.active = 1) as members
        from conversations c
        where $condition
        order by members desc;
        """.trimIndent()
    ).map { row ->
        ViberGroup(
            conversationId = row.requireLong("_id"),
            groupId = row.long("group_id") ?: 0L,
            name = row.string("name"),
            conversationType = row.int("conversation_type") ?: 0,
            memberCount = row.int("members") ?: 0,
        )
    }

    fun members(conversationId: Long, includeInactive: Boolean = false): List<ViberMember> =
        query(condition = "p.conversation_id = $conversationId", includeInactive = includeInactive)

    fun membersOfGroup(groupName: String, includeInactive: Boolean = false): List<ViberMember> =
        query(condition = "c.name = ${quote(groupName)}", includeInactive = includeInactive)

    private fun query(condition: String, includeInactive: Boolean): List<ViberMember> {
        val activeFilter = if (includeInactive) "" else "\n          and p.active = 1"
        return executor.query(
            """
            select p._id as participant_id,
                   i._id as info_id,
                   i.member_id as member_id,
                   i.encrypted_member_id as encrypted_member_id,
                   i.number as number,
                   i.display_name as display_name,
                   i.contact_name as contact_name,
                   i.viber_name as viber_name,
                   p.alias_name as alias_name,
                   p.active as active,
                   p.group_role as group_role,
                   max(case when i.participant_type = 1 then 2 when i.number glob '+[0-9]*' then 1 else 0 end) as card_rank
            from participants p
            join conversations c on c._id = p.conversation_id
            join participants_info i on i._id = p.participant_info_id
            where $condition$activeFilter
            group by coalesce(nullif(i.encrypted_member_id, ''), i.member_id, 'row' || i._id)
            order by i.display_name;
            """.trimIndent()
        ).map { row ->
            ViberMember(
                participantId = row.requireLong("participant_id"),
                infoId = row.long("info_id") ?: 0L,
                memberId = row.string("member_id"),
                encryptedMemberId = row.string("encrypted_member_id"),
                number = row.string("number"),
                displayName = row.string("display_name"),
                contactName = row.string("contact_name"),
                viberName = row.string("viber_name"),
                aliasName = row.string("alias_name"),
                active = row.boolean("active"),
                groupRole = row.int("group_role") ?: 0,
            )
        }
    }

    /** Единственный способ внести строку в запрос: удвоенная кавычка — экранирование sqlite. */
    private fun quote(value: String): String = "'" + value.replace("'", "''") + "'"
}
