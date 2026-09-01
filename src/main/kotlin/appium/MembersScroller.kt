package com.viber.appium

import io.appium.java_client.AppiumBy
import io.appium.java_client.android.AndroidDriver
import io.appium.java_client.android.nativekey.AndroidKey
import io.appium.java_client.android.nativekey.KeyEvent
import org.openqa.selenium.WebElement
import org.openqa.selenium.remote.RemoteWebElement
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
            val listElement = driver.findElement(AppiumBy.id("com.viber.voip:id/recycler_view"))
            val rows = listElement.findElements(AppiumBy.id("com.viber.voip:id/itemLayout"))
            var clickedInThisPass = false

            for (row in rows) {
                val clickedUserName = processSingleRow(driver, row, processedUsers)

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

    private fun processSingleRow(driver: AndroidDriver, row: WebElement, processedUsers: MutableSet<String>): String? {
        val name = driver.withZeroWait {
            row.findElements(AppiumBy.id("com.viber.voip:id/name")).firstOrNull()?.text
        } ?: return null

        if (processedUsers.contains(name)) return null

        if (name.startsWith("Вы ") || name.startsWith("Вы(")) {
            processedUsers.add(name)
            return null
        }

        if (isUserAdmin(driver, row)) {
            logger.info("Skipped admin: $name")
            processedUsers.add(name)
            return null
        }

        row.findElement(AppiumBy.id("com.viber.voip:id/group")).click()
        logger.info("Clicked on user: $name")
        processedUsers.add(name)

        return name
    }

    private fun isUserAdmin(driver: AndroidDriver, row: WebElement): Boolean {
        return driver.withZeroWait {
            val roleBadges = row.findElements(AppiumBy.id("com.viber.voip:id/groupRole"))
            if (roleBadges.isNotEmpty()) {
                val roleText = roleBadges.first().text
                roleText == "АДМИНИСТРАТОР" || roleText == "СУПЕР-АДМИН"
            } else {
                false
            }
        }
    }

    private fun clickMessageAndReturn(driver: AndroidDriver, userName: String): Boolean {
        val messageButtonSelector = "new UiSelector().resourceId(\"android:id/title\").textStartsWith(\"Сообщение\")"
        try {
            driver.manage().timeouts().implicitlyWait(Duration.ofSeconds(3))
            val messageButton = driver.findElement(AppiumBy.androidUIAutomator(messageButtonSelector))
            messageButton.click()
            logger.info("Clicked 'Сообщение' for user: $userName")
        } catch (e: Exception) {
            logger.warn("Could not find 'Сообщение' button for $userName. Tapping outside to close.", e)
            driver.executeScript("mobile: clickGesture", mapOf("x" to 50, "y" to 150))
            return false
        } finally {
            driver.manage().timeouts().implicitlyWait(Duration.ofSeconds(10))
        }

        try {
            driver.pressKey(KeyEvent(AndroidKey.BACK))
        } catch (e: Exception) {
            logger.error("Failed to press BACK button", e)
        }

        val isBackToList = driver.withZeroWait {
            driver.findElements(AppiumBy.id("com.viber.voip:id/recycler_view")).isNotEmpty()
        }
        if (isBackToList) {
            return false
        }
        val isMainList = driver.withZeroWait {
            driver.findElements(AppiumBy.id("com.viber.voip:id/messages_list")).isNotEmpty()
        }
        if (isMainList) {
            return true
        }

        throw IllegalStateException("Navigation completely lost after user $userName. Neither members list nor main list found.")
    }

    private fun getFirstRowText(driver: AndroidDriver): String? {
        return driver.withZeroWait {
            val listCheck = driver.findElements(AppiumBy.id("com.viber.voip:id/recycler_view")).firstOrNull()
            listCheck?.findElements(AppiumBy.id("com.viber.voip:id/itemLayout"))
                ?.firstOrNull()
                ?.findElements(AppiumBy.id("com.viber.voip:id/name"))
                ?.firstOrNull()?.text
        }
    }

    private fun fastScrollToUser(driver: AndroidDriver, targetName: String) {
        logger.info("Fast-forwarding back to user: $targetName")
        try {
            val scrollSelector = "new UiScrollable(new UiSelector().resourceId(\"com.viber.voip:id/recycler_view\").scrollable(true))" +
                    ".setMaxSearchSwipes(100).scrollIntoView(new UiSelector().text(\"$targetName\"))"
            driver.findElement(AppiumBy.androidUIAutomator(scrollSelector))

            val listForScroll = driver.findElement(AppiumBy.id("com.viber.voip:id/recycler_view"))
            driver.executeScript("mobile: scrollGesture", mapOf(
                "elementId" to (listForScroll as RemoteWebElement).id,
                "direction" to "down",
                "percent" to 0.4,
                "speed" to 7000
            ))
        } catch (e: Exception) {
            logger.warn("Fast scroll failed or user already visible", e)
        }
    }

    private fun scrollListDown(driver: AndroidDriver) {
        val listForScroll = driver.findElement(AppiumBy.id("com.viber.voip:id/recycler_view"))
        val elementId = (listForScroll as? RemoteWebElement)?.id
            ?: throw IllegalStateException("elementId is null")

        val args = mapOf(
            "elementId" to elementId,
            "direction" to "down",
            "percent" to 1,
            "speed" to 7000
        )
        driver.executeScript("mobile: scrollGesture", args)
    }

    private fun <T> AndroidDriver.withZeroWait(block: () -> T): T {
        this.manage().timeouts().implicitlyWait(Duration.ZERO)
        try {
            return block()
        } finally {
            this.manage().timeouts().implicitlyWait(Duration.ofSeconds(10))
        }
    }


}