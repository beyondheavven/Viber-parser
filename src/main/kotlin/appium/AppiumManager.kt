package com.viber.appium

import com.viber.appium.navigation.GroupNavigator
import com.viber.appium.navigation.MembersScroller
import com.viber.config.AppiumSettings
import io.appium.java_client.Setting
import io.appium.java_client.android.AndroidDriver
import io.appium.java_client.android.options.UiAutomator2Options
import org.slf4j.Logger
import org.slf4j.LoggerFactory
import java.net.URI

object AppiumManager {

    private val logger: Logger = LoggerFactory.getLogger(AppiumManager::class.java)

    var driver: AndroidDriver? = null
    private set

    @Volatile
    var currentState: ParserState = ParserState.IDLE
    private set

    lateinit var settings: AppiumSettings
    private set

    fun configure(newSettings: AppiumSettings) {
        if (driver != null) {
            logger.warn("Session is active — new Appium settings will apply on the next startSession()")
        }
        settings = newSettings
        logger.info("Appium settings: ${newSettings.describe()}")
    }

    fun startSession() {
        if (driver != null) {
            logger.warn("startSession() is already running")
            return
        }
        val config = settings

        currentState = ParserState.INITIALIZING

        logger.info("Starting session")
        try {
            if (config.autoConnectAdb && config.udid != null) {
                AdbConnector.ensureConnected(config.udid, config.adbPath)
            }

            val options = UiAutomator2Options()
                .setDeviceName(config.deviceName)
                .setAutomationName("UiAutomator2")
                .setNoReset(true)
                .setAppPackage(config.appPackage)
                .setAppActivity(config.appActivity)
                .setNewCommandTimeout(config.newCommandTimeout)
                .setAdbExecTimeout(config.adbExecTimeout)
            config.udid?.let { options.setUdid(it) }
            config.platformVersion?.let { options.setPlatformVersion(it) }
            config.systemPort?.let { options.setSystemPort(it) }

            val serviceUri = URI.create(config.serverUrl).toURL()

            driver = AndroidDriver (serviceUri, options).apply {
                manage().timeouts().implicitlyWait(config.implicitWait)
                setSetting(Setting.WAIT_FOR_IDLE_TIMEOUT, 100)
                setSetting(Setting.IGNORE_UNIMPORTANT_VIEWS, true)
            }
            currentState = ParserState.RUNNING
            logger.info("Started session successfully")
        } catch (e: Exception) {
            currentState = ParserState.ERROR
            logger.warn("Failed to start session Appium (${config.describe()})", e)
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
}
