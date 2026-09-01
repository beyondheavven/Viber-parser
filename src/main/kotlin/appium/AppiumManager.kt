package com.viber.appium

import io.appium.java_client.android.AndroidDriver
import io.appium.java_client.android.options.UiAutomator2Options
import org.slf4j.Logger
import org.slf4j.LoggerFactory
import java.net.URI
import java.time.Duration

object AppiumManager {

    private val logger: Logger = LoggerFactory.getLogger(AppiumManager::class.java)

    var driver: AndroidDriver? = null
    private set

    @Volatile
    var currentState: ParserState = ParserState.IDLE
    private set

    fun startSession() {
        if (driver != null) {
            logger.warn("startSession() is already running")
            return
        }
        currentState = ParserState.INITIALIZING
        logger.info("Starting session")
        try {
            val options = UiAutomator2Options()
                .setDeviceName("android-emulator")
                .setAutomationName("UiAutomator2")
                .setNoReset(true)
                .setAppPackage("com.viber.voip")
                .setAppActivity("com.viber.voip.WelcomeActivity")
                .setNewCommandTimeout(Duration.ofMinutes(5))
            val serviceUri = URI.create("http://127.0.0.1:4773").toURL()

            driver = AndroidDriver (serviceUri, options).apply {
                manage().timeouts().implicitlyWait(Duration.ofSeconds(10))
            }
            currentState = ParserState.RUNNING
            logger.info("Started session successfully")
        } catch (e: Exception) {
            currentState = ParserState.ERROR
            logger.warn("Failed to start session Appium", e)
            throw e
        }
    }

    fun stopSession() {
        logger.info("Stopping session")
        driver?.quit()
        driver = null
        currentState = ParserState.IDLE
    }

    fun scrollMembers(groupName: String){
        val d = driver ?: run {
            logger.error("scrollMembers() called without driver")
            throw NullPointerException("scrollMembers() called without driver")
        }

        logger.info("Pinning group: $groupName")
        GroupNavigator.pinGroup(d, groupName)

        logger.info("Opening group: $groupName")
        GroupNavigator.openGroup(d, groupName)
        GroupNavigator.openMembersList(d)
        MembersScroller.processRegularMembers(d, maxSwipes = 100) {
            logger.info("Re-opening group after chat navigation...")
            GroupNavigator.openGroup(d, groupName)
            GroupNavigator.openMembersList(d)
        }
    }

    fun executeRootCommand(command: String): String {
        val currentDriver = driver ?: throw IllegalStateException("Driver not initialized")
        logger.debug("Executing $command")
        val args = mapOf(
            "command" to "su",
            "args" to listOf("-c", command)
        )
        return currentDriver.executeScript("mobile: shell", args).toString()
    }
}