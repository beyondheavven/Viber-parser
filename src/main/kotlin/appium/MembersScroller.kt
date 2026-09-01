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

    fun processRegularMembers(driver: AndroidDriver, maxSwipes: Int = 100) {
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
            processCurrentScreen(driver, processedUsers)
            scrollListDown(driver)
        }

    }

    private fun processCurrentScreen(driver: AndroidDriver, processedUsers: MutableSet<String>) {
        var screenProcessed = false
        while (!screenProcessed) {
            val listElement = driver.findElement(AppiumBy.id("com.viber.voip:id/recycler_view"))
            val rows = listElement.findElements(AppiumBy.id("com.viber.voip:id/itemLayout"))
            var clickedInThisPass = false

            for (row in rows) {
                if (processSingleRow(driver, row, processedUsers)){
                    clickedInThisPass = true
                    break
                }
            }

            if(!clickedInThisPass) {
                screenProcessed = true
            }
        }
    }

    private fun processSingleRow(driver: AndroidDriver, row: WebElement, processedUsers: MutableSet<String>): Boolean {
        val name = driver.withZeroWait {
            row.findElements(AppiumBy.id("com.viber.voip:id/name")).firstOrNull()?.text
        } ?: return false

        if (processedUsers.contains(name)) return false

        if (name.startsWith("Вы ") || name.startsWith("Вы(")) {
            processedUsers.add(name)
            return false
        }

        if (isUserAdmin(driver, row)) {
            logger.info("Skipped admin: $name")
            processedUsers.add(name)
            return false
        }

        row.findElement(AppiumBy.id("com.viber.voip:id/group")).click()
        logger.info("Clicked on user: $name")
        processedUsers.add(name)

        closeDialogIfOpened(driver)
        return true
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

    private fun closeDialogIfOpened(driver: AndroidDriver) {
        val isDialogOpen = driver.withZeroWait {
            driver.findElements(AppiumBy.androidUIAutomator("new UiSelector().textContains(\"Сообщение\")")).isNotEmpty()
        }

        if (isDialogOpen) {
            driver.executeScript("mobile: clickGesture", mapOf("x" to 50, "y" to 150))
            Thread.sleep(500)
        }

        var retries = 3
        while (retries > 0) {
            val isBackToList = driver.withZeroWait {
                driver.findElements(AppiumBy.id("com.viber.voip:id/recycler_view")).isNotEmpty()
            }

            if (isBackToList) {
                return
            }

            logger.warn("Not on the members list! Pressing hardware BACK button. Retries left: $retries")
            try {
                driver.pressKey(KeyEvent(AndroidKey.BACK))
            } catch (e: Exception) {
                logger.error("Failed to press BACK button", e)
            }
            Thread.sleep(1000)
            retries--
        }
        throw IllegalStateException("Failed to return to the members list after clicking a user.")
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