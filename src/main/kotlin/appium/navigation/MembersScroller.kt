package com.viber.appium.navigation

import com.viber.appium.navigation.ViberLocator.ITEM_LAYOUT
import com.viber.appium.navigation.ViberLocator.MESSAGES_LIST
import com.viber.appium.navigation.ViberLocator.MESSAGE_BUTTON
import com.viber.appium.navigation.ViberLocator.RECYCLER_VIEW
import com.viber.appium.navigation.ViberLocator.USER_GROUP_ROLE
import com.viber.appium.navigation.ViberLocator.USER_NAME
import com.viber.appium.navigation.ViberLocator.VIBER_GROUP
import io.appium.java_client.AppiumBy
import io.appium.java_client.android.AndroidDriver
import io.appium.java_client.android.nativekey.AndroidKey
import io.appium.java_client.android.nativekey.KeyEvent
import org.openqa.selenium.WebElement
import org.openqa.selenium.remote.RemoteWebElement
import org.openqa.selenium.support.ui.WebDriverWait
import org.slf4j.LoggerFactory
import java.time.Duration

object MembersScroller {

    private val logger = LoggerFactory.getLogger(MembersScroller::class.java)

    fun processRegularMembers(driver: AndroidDriver, maxSwipes: Int = 100, onRecover: () -> Unit) {
        var previousFirstText: String? = null
        var sameStateCount = 0
        val processedUsers = mutableSetOf<String>()

        for (swipe in 0 until maxSwipes) {
            val currentFirstText = getFirstRowText(driver)

            if (currentFirstText != null && currentFirstText == previousFirstText) {
                sameStateCount++
                if (sameStateCount >=2){
                    logger.info("List is not changing on step $swipe. Reached the end.")
                    break
                }
            } else {
                sameStateCount = 0
            }

            previousFirstText = currentFirstText
            processCurrentScreen(driver, processedUsers, onRecover)
            scrollListDown(driver)
        }

    }

    private fun processCurrentScreen(driver: AndroidDriver, processedUsers: MutableSet<String>, onRecover: () -> Unit) {
        var screenProcessed = false
        while (!screenProcessed) {
            val listElement = driver.findElement(RECYCLER_VIEW)
            val rows = listElement.findElements(ITEM_LAYOUT)
            var clickedInThisPass = false

            for (row in rows) {
                val clickedUserName = processSingleRow(row, processedUsers)
                if(clickedUserName != null){
                    val kickedToMainList = clickMessageAndReturn(driver, clickedUserName)

                    if (kickedToMainList) {
                        logger.warn("Kicked to main list! Recovering state...")
                        onRecover()
                        fastScrollToUser(driver, clickedUserName)
                    }

                    clickedInThisPass = true
                    break
                }
            }

            if(!clickedInThisPass) {
                screenProcessed = true
            }
        }
    }

    private fun processSingleRow(row: WebElement, processedUsers: MutableSet<String>): String? {
        val name = row.findElements(USER_NAME).firstOrNull()?.text ?: return null

        if (processedUsers.contains(name)) return null

        if (name.startsWith("Вы ") || name.startsWith("Вы(")) {
            processedUsers.add(name)
            return null
        }

        if (isUserAdmin(row)) {
            logger.info("Skipped admin: $name")
            processedUsers.add(name)
            return null
        }

        row.findElement(VIBER_GROUP).click()
        logger.info("Clicked on user: $name")
        processedUsers.add(name)
        return name
    }

    private fun isUserAdmin(row: WebElement): Boolean {
        val roleBadges = row.findElements(USER_GROUP_ROLE)
        if (roleBadges.isNotEmpty()) {
            val roleText = roleBadges.first().text
            return roleText == "АДМИНИСТРАТОР" || roleText == "СУПЕР-АДМИН"
        }
        return false
    }

    private fun clickMessageAndReturn(driver: AndroidDriver, userName: String): Boolean {
        try {
            val wait = WebDriverWait(driver, Duration.ofSeconds(2))
            val messageButton = driver.findElement(MESSAGE_BUTTON)
            messageButton.click()
            logger.info("Clicked 'Сообщение' for user: $userName")
        } catch (e: Exception) {
            logger.warn("Could not find 'Сообщение' button for $userName. Tapping outside to close.", e)
            driver.executeScript("mobile: clickGesture", mapOf("x" to 50, "y" to 150))
            return false
        }

        try {
            driver.pressKey(KeyEvent(AndroidKey.BACK))
        } catch (e: Exception) {
            logger.error("Failed to press BACK button", e)
        }

        var retries = 3
        while (retries > 0) {
            val isBackToList = driver.findElements(RECYCLER_VIEW).isNotEmpty()

            if (isBackToList) {
                return false
            }
            val isMainList = driver.findElements(MESSAGES_LIST).isNotEmpty()
            if (isMainList) {
                return true
            }
            retries--

            if (retries == 2) {
                logger.warn("Still not back. Pressing BACK again...")
                try { driver.pressKey(KeyEvent(AndroidKey.BACK)) } catch (e: Exception) { }
            }
        }

        throw IllegalStateException("Navigation completely lost after user $userName. Neither members list nor main list found.")
    }

    private fun getFirstRowText(driver: AndroidDriver): String? {
        val listCheck = driver.findElements(RECYCLER_VIEW).firstOrNull()
        return listCheck?.findElements(ITEM_LAYOUT)
            ?.firstOrNull()
            ?.findElements(USER_NAME)
            ?.firstOrNull()?.text
    }

    private fun fastScrollToUser(driver: AndroidDriver, targetName: String) {
        logger.info("Fast-forwarding back to user: $targetName")
        try {
            val scrollSelector = "new UiScrollable(new UiSelector().resourceId(\"com.viber.voip:id/recycler_view\").scrollable(true))" +
                    ".setMaxSearchSwipes(100).scrollIntoView(new UiSelector().text(\"$targetName\"))"
            driver.findElement(AppiumBy.androidUIAutomator(scrollSelector))

            val listForScroll = driver.findElement(RECYCLER_VIEW)
            driver.executeScript("mobile: scrollGesture", mapOf(
                "elementId" to (listForScroll as RemoteWebElement).id,
                "direction" to "down",
                "percent" to 0.5,
                "speed" to 4000
            ))
        } catch (e: Exception) {
            logger.warn("Fast scroll failed or user already visible", e)
        }
    }

    private fun scrollListDown(driver: AndroidDriver) {
        val listForScroll = driver.findElement(RECYCLER_VIEW)
        val elementId = (listForScroll as? RemoteWebElement)?.id
            ?: throw IllegalStateException("elementId is null")

        val args = mapOf(
            "elementId" to elementId,
            "direction" to "down",
            "percent" to 0.5,
            "speed" to 4000
        )
        driver.executeScript("mobile: scrollGesture", args)
    }
}