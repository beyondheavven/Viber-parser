package com.viber.device

import com.viber.device.model.ViberGroup
import com.viber.device.model.ViberMember

/**
 * Типизированные выборки поверх `viber_messages`.
 *
 * Значения подставляются в SQL текстом (устройский sqlite3 гоняем как CLI, плейсхолдеров
 * там нет), поэтому строки обязаны проходить через [quote] — см. тест про имя с кавычкой.
 */
class ViberDatabase(private val executor: SqlExecutor) {

    fun groups(): List<ViberGroup> = groupsWhere(GROUP_CONVERSATION)

    /** Одна группа по id беседы — нужен, чтобы отличать «нет такой группы» от «группа пустая». */
    fun group(conversationId: Long): ViberGroup? =
        groupsWhere("c._id = $conversationId and $GROUP_CONVERSATION").firstOrNull()

    fun members(conversationId: Long, includeInactive: Boolean = false): List<ViberMember> =
        membersWhere("p.conversation_id = $conversationId", includeInactive)

    fun membersOfGroup(groupName: String, includeInactive: Boolean = false): List<ViberMember> =
        membersWhere("c.name = ${quote(groupName)}", includeInactive)

    private fun groupsWhere(condition: String): List<ViberGroup> = executor.query(
        """
        select c._id as _id,
               c.group_id as group_id,
               c.name as name,
               c.conversation_type as conversation_type,
               (select count(distinct $PERSON_KEY)
                from participants p
                join participants_info i on i._id = p.participant_info_id
                where p.conversation_id = c._id and p.active = 1) as members
        from conversations c
        where $condition
        order by members desc;
        """.trimIndent()
    ).map { it.toViberGroup() }

    private fun membersWhere(condition: String, includeInactive: Boolean): List<ViberMember> {
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
                   $CARD_RANK as card_rank
            from participants p
            join conversations c on c._id = p.conversation_id
            join participants_info i on i._id = p.participant_info_id
            where $condition$activeFilter
            group by $PERSON_KEY
            order by i.display_name;
            """.trimIndent()
        ).map { it.toViberMember() }
    }

    private companion object {

        /** Групповая беседа, которую пользователь не удалил. */
        const val GROUP_CONVERSATION = "c.group_id != 0 and c.deleted = 0"

        /**
         * Человек, а не строка таблицы. Viber держит одного участника **двумя** карточками в
         * `participants_info`: `participant_type = 1` с настоящим номером и `participant_type = 2`,
         * где вместо номера лежит зашифрованное значение. Обе карточки прописаны в `participants`,
         * поэтому без склейки список задваивается — в живой группе 53 строки против 38 человек.
         *
         * Ключ — `encrypted_member_id`: он одинаков у обеих карточек, тогда как `member_id` у
         * второй карточки сам подменён зашифрованным значением, и склейка по нему не сработала бы.
         * `_id` в хвосте оставляет несклеенными записи вообще без ключа, чтобы разные люди не
         * схлопнулись в одного.
         */
        const val PERSON_KEY = "coalesce(nullif(i.encrypted_member_id, ''), i.member_id, 'row' || i._id)"

        /**
         * Какая из карточек человека выигрывает: сначала `participant_type = 1`, затем любая, где
         * в `number` действительно телефон. Оконных функций в sqlite 3.22 на устройстве нет, поэтому
         * выбор строки держится на `max()` + bare columns — sqlite отдаёт остальные колонки из той
         * строки, где достигнут максимум.
         */
        const val CARD_RANK =
            "max(case when i.participant_type = 1 then 2 when i.number glob '+[0-9]*' then 1 else 0 end)"
    }
}
