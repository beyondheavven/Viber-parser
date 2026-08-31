package com.viber.appium

import appium.ParserState
import io.appium.java_client.android.AndroidDriver
import io.appium.java_client.android.options.UiAutomator2Options
import java.net.URI
import java.net.URL
import java.time.Duration
import java.util.concurrent.TimeUnit

object AppiumManager {
    var driver: AndroidDriver? = null
    private set

    @Volatile
    var currentState: ParserState = ParserState.IDLE
    private set

    fun startSession() {
        if (driver != null) return
        currentState = ParserState.INITIALIZING
        try {
            val options = UiAutomator2Options()
                .setDeviceName("android-emulator")
                .setAutomationName("UiAutomator2")
                .setNoReset(true)
                .setAppPackage("com.viber.voip")
                .setAppActivity("com.viber.voip.WelcomeActivity")

            val serviceUri = URI.create("http://127.0.0.1:4773").toURL()

            driver = AndroidDriver (serviceUri, options).apply {
                manage().timeouts().implicitlyWait(Duration.ofSeconds(10))
            }
            currentState = ParserState.RUNNING
        } catch (e: Exception) {
            currentState = ParserState.ERROR
            throw e
        }
    }

    fun stopSession() {
        driver?.quit()
        driver = null
        currentState = ParserState.IDLE
    }

    fun executeRootCommand(command: String): String {
        val currentDriver = driver ?: throw IllegalStateException("Driver not initialized")

        val args = mapOf(
            "command" to "su",
            "args" to listOf("-c", command)
        )

        return currentDriver.executeScript("mobile: shell", args).toString()
    }
}