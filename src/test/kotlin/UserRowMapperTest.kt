package com.viber

import com.viber.models.ParticipantModel
import com.viber.services.UserRowMapper
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull

class UserRowMapperTest {

    private val now = "2026-09-23T12:00:00Z"

    private fun participant(
        memberId: String? = "Da54i3JfZcA=",
        number: String? = "+375 33 643-33-50",
        name: String? = "Alice",
        contactName: String? = null,
        viberName: String? = "alice_v",
        isSelf: Boolean = false,
        isOnline: Boolean? = null,
        lastSeen: String? = null,
    ) = ParticipantModel(
        id = 7,
        memberId = memberId,
        number = number,
        name = name,
        contactName = contactName,
        viberName = viberName,
        groupRole = 3,
        roleLabel = "member",
        active = true,
        isSelf = isSelf,
        isOnline = isOnline,
        lastSeen = lastSeen,
    )

    @Test
    fun `keys a decoded member on its member id and keeps the phone in E164`() {
        val row = assertNotNull(UserRowMapper.toUserRow(participant(), now))

        assertEquals("Da54i3JfZcA=", row.identityKey)
        assertEquals("Da54i3JfZcA=", row.memberId)
        assertEquals("+375336433350", row.phone)
        assertEquals("Alice", row.name)
        assertEquals("alice_v", row.viberName)
        assertEquals(now, row.updatedAt)
    }

    @Test
    fun `falls back to the phone while the member id is still encrypted`() {
        val row = assertNotNull(
            UserRowMapper.toUserRow(participant(memberId = "em:AQANrniLcl9lwBpv"), now),
        )

        assertEquals("phone:375336433350", row.identityKey)
        assertNull(row.memberId)
        assertEquals("+375336433350", row.phone)
    }

    @Test
    fun `drops the automated account itself`() {
        assertNull(UserRowMapper.toUserRow(participant(isSelf = true), now))
    }

    @Test
    fun `drops members with nothing to key on`() {
        assertNull(UserRowMapper.toUserRow(participant(memberId = "em:x", number = "Ожидает дешифровки"), now))
        assertNull(UserRowMapper.toUserRow(participant(memberId = null, number = "12345"), now))
    }

    @Test
    fun `treats placeholder phones as unknown`() {
        assertNull(UserRowMapper.normalizePhone("em:AQAN"))
        assertNull(UserRowMapper.normalizePhone("Ожидает дешифровки"))
        assertNull(UserRowMapper.normalizePhone("  "))
        assertNull(UserRowMapper.normalizePhone("+1 234"))
        assertEquals("+48794034881", UserRowMapper.normalizePhone("48 794 034 881"))
    }

    @Test
    fun `picks the best name and ignores placeholders`() {
        val row = assertNotNull(
            UserRowMapper.toUserRow(participant(name = "(без имени)", viberName = "", contactName = "Bob"), now),
        )

        assertEquals("Bob", row.name)
        assertNull(row.viberName)
    }

    @Test
    fun `carries online status through untouched`() {
        val row = assertNotNull(
            UserRowMapper.toUserRow(participant(isOnline = true, lastSeen = "2026-09-22T10:00:00.000Z"), now),
        )

        assertEquals(true, row.isOnline)
        assertEquals("2026-09-22T10:00:00.000Z", row.lastSeenAt)
    }

    @Test
    fun `group key prefers the 64-bit viber id`() {
        assertEquals("1234567890123456789", UserRowMapper.groupKey("1234567890123456789", 42))
        assertEquals("conv:42", UserRowMapper.groupKey(null, 42))
        assertEquals("conv:42", UserRowMapper.groupKey("  ", 42))
    }
}
