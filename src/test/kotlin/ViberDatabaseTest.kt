package com.viber

import com.viber.device.SqlExecutor
import com.viber.device.sqlite.Row
import com.viber.device.sqlite.SqliteCsv
import com.viber.device.viber.ViberDatabase
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class ViberDatabaseTest {

    /** Отдаёт заранее подготовленный CSV и запоминает запрос — устройство для этого не нужно. */
    private class FakeExecutor(private val csv: String = "") : SqlExecutor {
        var lastSql: String? = null
        override fun query(sql: String): List<Row> {
            lastSql = sql
            return SqliteCsv.parse(csv)
        }
    }

    @Test
    fun `maps group rows into the model`() {
        val executor = FakeExecutor(
            "_id,group_id,name,conversation_type,members\r\n" +
                "20,1234567890,\"Моя группа\",5,58\r\n" +
                "1,987,,5,6\r\n"
        )

        val groups = ViberDatabase(executor).groups()

        assertEquals(2, groups.size)
        assertEquals(20L, groups[0].conversationId)
        assertEquals(1234567890L, groups[0].groupId)
        assertEquals("Моя группа", groups[0].name)
        assertEquals(5, groups[0].conversationType)
        assertEquals(58, groups[0].memberCount)
        assertEquals(null, groups[1].name)
    }

    @Test
    fun `lists only real group conversations that are still there`() {
        val executor = FakeExecutor()

        ViberDatabase(executor).groups()

        val sql = executor.lastSql!!
        assertTrue(sql.contains("group_id != 0"), sql)
        assertTrue(sql.contains("deleted = 0"), sql)
        assertTrue(sql.contains("from conversations"), sql)
    }

    @Test
    fun `finds a single group by its conversation id`() {
        val executor = FakeExecutor(
            "_id,group_id,name,conversation_type,members\r\n20,1234567890,\"Моя группа\",5,53\r\n"
        )

        val group = ViberDatabase(executor).group(conversationId = 20)!!

        assertEquals(20L, group.conversationId)
        assertEquals(53, group.memberCount)
        assertTrue(executor.lastSql!!.contains("c._id = 20"), executor.lastSql!!)
    }

    @Test
    fun `returns no group when the id is unknown`() {
        assertEquals(null, ViberDatabase(FakeExecutor()).group(conversationId = 999))
    }

    @Test
    fun `maps member rows joined across participants and participants_info`() {
        val executor = FakeExecutor(
            "participant_id,info_id,member_id,encrypted_member_id,number,display_name,contact_name,viber_name,alias_name,active,group_role\r\n" +
                "77,12,MID123,em:AQA2/Zs,+380671234567,\"Ievgen Bodnar\",\"Ievgen\",\"Bodnar\",,1,3\r\n"
        )

        val members = ViberDatabase(executor).members(conversationId = 20)

        assertEquals(1, members.size)
        val member = members.single()
        assertEquals(77L, member.participantId)
        assertEquals(12L, member.infoId)
        assertEquals("MID123", member.memberId)
        assertEquals("em:AQA2/Zs", member.encryptedMemberId)
        assertEquals("+380671234567", member.number)
        assertEquals("Ievgen Bodnar", member.displayName)
        assertEquals("Ievgen", member.contactName)
        assertEquals("Bodnar", member.viberName)
        assertEquals(null, member.aliasName)
        assertTrue(member.active)
        assertEquals(3, member.groupRole)

        val sql = executor.lastSql!!
        assertTrue(sql.contains("join participants_info"), sql)
        assertTrue(sql.contains("p.conversation_id = 20"), sql)
    }

    @Test
    fun `hides members who left the group unless asked for them`() {
        val executor = FakeExecutor()

        ViberDatabase(executor).members(conversationId = 20)
        assertTrue(executor.lastSql!!.contains("p.active = 1"), executor.lastSql!!)

        ViberDatabase(executor).members(conversationId = 20, includeInactive = true)
        assertTrue(!executor.lastSql!!.contains("p.active = 1"), executor.lastSql!!)
    }

    @Test
    fun `collapses the two cards Viber keeps for one person`() {
        val executor = FakeExecutor()

        ViberDatabase(executor).members(conversationId = 20)

        val sql = executor.lastSql!!
        // Ключ — encrypted_member_id; member_id и _id только как запасной вариант,
        // иначе записи без ключа схлопнулись бы в одного человека.
        assertTrue(sql.contains("group by coalesce(nullif(i.encrypted_member_id, ''), i.member_id, 'row' || i._id)"), sql)
    }

    @Test
    fun `keeps the card that carries the real phone number`() {
        val executor = FakeExecutor()

        ViberDatabase(executor).members(conversationId = 20)

        // participant_type = 2 хранит зашифрованный номер вместо телефона — такая
        // карточка проигрывает при склейке. max() + bare columns: в sqlite 3.22
        // на устройстве оконных функций нет.
        val sql = executor.lastSql!!
        assertTrue(sql.contains("max(case when i.participant_type = 1 then 2"), sql)
        assertTrue(sql.contains("i.number glob '+[0-9]*'"), sql)
    }

    @Test
    fun `counts people, not rows, when listing groups`() {
        val executor = FakeExecutor()

        ViberDatabase(executor).groups()

        val sql = executor.lastSql!!
        assertTrue(sql.contains("count(distinct coalesce(nullif(i.encrypted_member_id, ''), i.member_id, 'row' || i._id))"), sql)
    }

    @Test
    fun `escapes a quote in the group name instead of letting it change the query`() {
        val executor = FakeExecutor()

        ViberDatabase(executor).membersOfGroup("O'Brian'; drop table participants; --")

        val sql = executor.lastSql!!
        assertTrue(sql.contains("'O''Brian''; drop table participants; --'"), sql)
    }

    @Test
    fun `looks a group up by its name`() {
        val executor = FakeExecutor()

        ViberDatabase(executor).membersOfGroup("Моя группа")

        val sql = executor.lastSql!!
        assertTrue(sql.contains("c.name = 'Моя группа'"), sql)
        assertTrue(sql.contains("join participants_info"), sql)
    }

    @Test
    fun `prefers the name a member carries inside the group`() {
        val header = "participant_id,info_id,member_id,encrypted_member_id,number,display_name,contact_name,viber_name,alias_name,active,group_role\r\n"
        val alias = ViberDatabase(FakeExecutor(header + "1,1,M,em:1,+1,\"Display\",\"Contact\",\"Viber\",\"Alias\",1,1\r\n"))
        val noAlias = ViberDatabase(FakeExecutor(header + "1,1,M,em:1,+1,\"Display\",\"Contact\",\"Viber\",,1,1\r\n"))
        val nameless = ViberDatabase(FakeExecutor(header + "1,1,M,em:1,+380671234567,,,,,1,1\r\n"))

        assertEquals("Alias", alias.members(1).single().displayedName)
        assertEquals("Display", noAlias.members(1).single().displayedName)
        assertEquals("+380671234567", nameless.members(1).single().displayedName)
    }

    @Test
    fun `returns nothing when the group has no rows`() {
        assertEquals(emptyList(), ViberDatabase(FakeExecutor()).membersOfGroup("nope"))
    }
}
