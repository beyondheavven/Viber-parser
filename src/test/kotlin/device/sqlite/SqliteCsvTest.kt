package com.viber.device.sqlite

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import kotlin.test.assertTrue

class SqliteCsvTest {

    @Test
    fun `parses a header and rows addressed by column name`() {
        val rows = SqliteCsv.parse("_id,display_name\r\n1,Milena\r\n2,Ievgen\r\n")

        assertEquals(2, rows.size)
        assertEquals("1", rows[0].string("_id"))
        assertEquals("Milena", rows[0].string("display_name"))
        assertEquals("Ievgen", rows[1].string("display_name"))
    }

    @Test
    fun `keeps separators and quotes that live inside a quoted field`() {
        val rows = SqliteCsv.parse("a,b\r\n\"hi, there\",\"quote\"\"inside\"\r\n")

        assertEquals("hi, there", rows[0].string("a"))
        assertEquals("quote\"inside", rows[0].string("b"))
    }

    @Test
    fun `tells NULL apart from an empty string`() {
        // sqlite3 -csv writes NULL as a bare empty field and '' as a quoted one.
        val rows = SqliteCsv.parse("n,empty,filled\r\n,\"\",x\r\n")

        assertNull(rows[0].string("n"))
        assertTrue(rows[0].isNull("n"))
        assertEquals("", rows[0].string("empty"))
        assertEquals(false, rows[0].isNull("empty"))
        assertEquals("x", rows[0].string("filled"))
    }

    @Test
    fun `keeps a line break that is part of a quoted value`() {
        val rows = SqliteCsv.parse("a,b\r\n\"two\nlines\",tail\r\n")

        assertEquals(1, rows.size)
        assertEquals("two\nlines", rows[0].string("a"))
        assertEquals("tail", rows[0].string("b"))
    }

    @Test
    fun `accepts bare LF endings as well as CRLF`() {
        val rows = SqliteCsv.parse("a,b\n1,2\n")

        assertEquals("1", rows[0].string("a"))
        assertEquals("2", rows[0].string("b"))
    }

    @Test
    fun `returns no rows for an empty result or a header on its own`() {
        assertEquals(emptyList(), SqliteCsv.parse(""))
        assertEquals(emptyList(), SqliteCsv.parse("   \r\n"))
        assertEquals(emptyList(), SqliteCsv.parse("_id,display_name\r\n"))
    }

    @Test
    fun `reads numbers and flags through typed accessors`() {
        val rows = SqliteCsv.parse("id,active,missing\r\n42,1,\r\n")

        assertEquals(42L, rows[0].long("id"))
        assertEquals(true, rows[0].boolean("active"))
        assertNull(rows[0].long("missing"))
        assertEquals(42L, rows[0].requireLong("id"))
    }

    @Test
    fun `fails loudly on an unknown column instead of returning null`() {
        val rows = SqliteCsv.parse("a\r\n1\r\n")

        val error = assertFailsWith<IllegalArgumentException> { rows[0].string("nope") }
        assertTrue(error.message!!.contains("nope"))
    }

    @Test
    fun `fails loudly when a required value is NULL`() {
        val rows = SqliteCsv.parse("a\r\n\r\n")

        assertFailsWith<IllegalStateException> { rows[0].requireString("a") }
    }
}
