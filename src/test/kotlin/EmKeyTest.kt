package com.viber

import com.viber.device.EmKey
import java.util.Base64
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class EmKeyTest {

    /** Живой ключ из базы: 8 байт `18f32f20c856a2e4` дают ровно `GPMvIMhWouQ=`. */
    private val key = byteArrayOf(0x18, 0xf3.toByte(), 0x2f, 0x20, 0xc8.toByte(), 0x56, 0xa2.toByte(), 0xe4.toByte())

    private fun envelope(
        version: ByteArray = byteArrayOf(0x01, 0x00),
        key: ByteArray = this.key,
        marker: ByteArray = byteArrayOf(0x1a, 0x6f),
        tail: ByteArray = ByteArray(30) { (it + 1).toByte() },
    ): String = Base64.getEncoder().encodeToString(version + key + marker + tail)

    @Test
    fun `takes the eight key bytes out of the envelope`() {
        assertEquals("GPMvIMhWouQ=", EmKey.extract(envelope()))
    }

    @Test
    fun `reads the same key whether or not the value carries the em prefix`() {
        val encoded = envelope()

        assertEquals(EmKey.extract(encoded), EmKey.extract("em:$encoded"))
    }

    @Test
    fun `ignores the whitespace around the value`() {
        assertEquals("GPMvIMhWouQ=", EmKey.extract("  ${envelope()}\n"))
    }

    @Test
    fun `refuses an envelope that is not 42 bytes`() {
        val short = Base64.getEncoder().encodeToString(ByteArray(41))

        val error = assertFailsWith<IllegalArgumentException> { EmKey.extract(short) }

        assertTrue(error.message!!.contains("42"), error.message!!)
    }

    @Test
    fun `refuses an unknown envelope version`() {
        val error = assertFailsWith<IllegalArgumentException> {
            EmKey.extract(envelope(version = byteArrayOf(0x02, 0x00)))
        }

        assertTrue(error.message!!.contains("version", ignoreCase = true), error.message!!)
    }

    @Test
    fun `refuses an envelope whose marker is not where it should be`() {
        val error = assertFailsWith<IllegalArgumentException> {
            EmKey.extract(envelope(marker = byteArrayOf(0x1a, 0x70)))
        }

        assertTrue(error.message!!.contains("marker", ignoreCase = true), error.message!!)
    }

    @Test
    fun `refuses a value that is not base64 at all`() {
        assertFailsWith<IllegalArgumentException> { EmKey.extract("не base64!") }
    }

    @Test
    fun `refuses an empty value`() {
        assertFailsWith<IllegalArgumentException> { EmKey.extract("   ") }
    }

    @Test
    fun `produces a key that is safe to put into sql as is`() {
        val extracted = EmKey.extract(envelope(key = ByteArray(8) { (it * 31).toByte() }))

        assertTrue(extracted.matches(Regex("[A-Za-z0-9+/=]+")), extracted)
        assertEquals(12, extracted.length)
    }
}
