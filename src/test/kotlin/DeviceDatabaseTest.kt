package com.viber

import com.viber.appium.AppiumManager
import com.viber.config.AppiumSettings
import com.viber.config.DatabaseSettings
import com.viber.db.AdbSqlite
import com.viber.db.DeviceDatabase
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class DeviceDatabaseTest {

    @Test
    fun `builds a client against the configured device and database`() {
        AppiumManager.configure(AppiumSettings(udid = "127.0.0.1:5557", adbPath = "adb"))
        DeviceDatabase.configure(DatabaseSettings(databasePath = "/data/data/com.viber.voip/databases/viber_data"))

        val command = (DeviceDatabase.executor() as AdbSqlite).command("select 1;")

        assertEquals(listOf("-s", "127.0.0.1:5557"), command.subList(1, 3))
        assertTrue(command.last().contains("/data/data/com.viber.voip/databases/viber_data"), command.last())
    }

    @Test
    fun `says what is missing when no device is configured`() {
        AppiumManager.configure(AppiumSettings(udid = null))

        val error = assertFailsWith<IllegalStateException> { DeviceDatabase.executor() }

        assertTrue(error.message!!.contains("udid"), error.message!!)
    }
}
