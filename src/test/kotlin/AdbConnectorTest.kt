package com.viber

import com.viber.appium.AdbConnector
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class AdbConnectorTest {

    @Test
    fun `network targets are the ones adb connect applies to`() {
        assertTrue(AdbConnector.isNetworkTarget("127.0.0.1:5555"))
        assertTrue(AdbConnector.isNetworkTarget("192.168.1.50:5557"))

        assertFalse(AdbConnector.isNetworkTarget("emulator-5554"))
        assertFalse(AdbConnector.isNetworkTarget("ce12171b"))
        assertFalse(AdbConnector.isNetworkTarget("127.0.0.1:notaport"))
        assertFalse(AdbConnector.isNetworkTarget(""))
    }

    @Test
    fun `explicitly configured adb path wins over every search root`() {
        val root = tempRootWithAdb("wins-over")
        try {
            assertEquals(
                "C:/LDPlayer/LDPlayer9/adb.exe",
                AdbConnector.resolveAdbExecutable(
                    configured = "C:/LDPlayer/LDPlayer9/adb.exe",
                    searchRoots = listOf(root.absolutePath),
                ),
            )
        } finally {
            root.deleteRecursively()
        }
    }

    @Test
    fun `picks the first search root that actually holds an adb binary`() {
        val empty = File(System.getProperty("java.io.tmpdir"), "viber-parser-empty-root").apply { mkdirs() }
        val real = tempRootWithAdb("real-root")
        try {
            assertEquals(
                File(real, adbBinaryName()).absolutePath,
                AdbConnector.resolveAdbExecutable(
                    configured = null,
                    searchRoots = listOf("/no/such/dir", empty.absolutePath, real.absolutePath),
                ),
            )
        } finally {
            empty.deleteRecursively()
            real.deleteRecursively()
        }
    }

    @Test
    fun `falls back to adb on PATH when no search root has one`() {
        assertEquals("adb", AdbConnector.resolveAdbExecutable(configured = null, searchRoots = emptyList()))
        assertEquals(
            "adb",
            AdbConnector.resolveAdbExecutable(configured = "   ", searchRoots = listOf("/no/such/dir")),
        )
    }

    @Test
    fun `default search roots cover the android sdk and LDPlayer installs`() {
        val roots = AdbConnector.defaultSearchRoots(
            androidHome = "C:/Sdk",
            androidSdkRoot = "D:/Sdk2",
            localAppData = "C:/Users/x/AppData/Local",
        ).map { it.replace(File.separatorChar, '/') }

        assertTrue(roots.contains("C:/Sdk/platform-tools"), "ANDROID_HOME must come first, got $roots")
        assertTrue(roots.contains("D:/Sdk2/platform-tools"))
        assertTrue(roots.contains("C:/Users/x/AppData/Local/Android/Sdk/platform-tools"))
        assertTrue(roots.any { it.contains("LDPlayer") }, "LDPlayer ships its own adb, got $roots")
        assertEquals(roots.distinct(), roots, "search roots must not repeat")
    }

    private fun adbBinaryName(): String =
        if (System.getProperty("os.name").startsWith("Windows")) "adb.exe" else "adb"

    private fun tempRootWithAdb(name: String): File =
        File(System.getProperty("java.io.tmpdir"), "viber-parser-$name").apply {
            mkdirs()
            File(this, adbBinaryName()).writeText("")
        }
}
