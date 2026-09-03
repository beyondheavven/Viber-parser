package com.viber

import com.viber.appium.AppiumManager
import com.viber.config.AppiumSettings
import com.viber.config.DatabaseSettings
import com.viber.device.AdbSqlite
import com.viber.device.DeviceDatabase
import java.time.Duration
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class DeviceDatabaseTest {

    private fun appiumSettings(udid: String?, adbPath: String?) = AppiumSettings(
        serverUrl = "http://127.0.0.1:4723",
        deviceName = "LDPlayer",
        udid = udid,
        platformVersion = "9",
        appPackage = "com.viber.voip",
        appActivity = "com.viber.voip.WelcomeActivity",
        systemPort = null,
        newCommandTimeout = Duration.ofSeconds(300),
        implicitWait = Duration.ZERO,
        adbExecTimeout = Duration.ofSeconds(60),
        adbPath = adbPath,
        autoConnectAdb = true,
    )

    @Test
    fun `builds a client against the configured device and database`() {
        AppiumManager.configure(appiumSettings(udid = "127.0.0.1:5557", adbPath = "adb"))
        DeviceDatabase.configure(DatabaseSettings(databasePath = "/data/data/com.viber.voip/databases/viber_data"))

        val command = (DeviceDatabase.executor() as AdbSqlite).command("select 1;")

        assertEquals(listOf("-s", "127.0.0.1:5557"), command.subList(1, 3))
        assertTrue(command.last().contains("/data/data/com.viber.voip/databases/viber_data"), command.last())
    }

    @Test
    fun `says what is missing when no device is configured`() {
        AppiumManager.configure(appiumSettings(udid = null, adbPath = null))

        val error = assertFailsWith<IllegalStateException> { DeviceDatabase.executor() }

        assertTrue(error.message!!.contains("udid"), error.message!!)
    }
}
