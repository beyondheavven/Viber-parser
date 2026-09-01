package com.viber.appium

import io.appium.java_client.AppiumBy
import io.appium.java_client.android.AndroidDriver
import io.appium.java_client.android.nativekey.AndroidKey
import io.appium.java_client.android.nativekey.KeyEvent
import org.openqa.selenium.remote.RemoteWebElement
import org.slf4j.LoggerFactory
import java.time.Duration

object MembersScroller {

    private val logger = LoggerFactory.getLogger(MembersScroller::class.java)

    fun processRegularMembers(driver: AndroidDriver, maxSwipes: Int = 100) {
        var previousFirstElementText: String? = null
        var sameStateCount = 0
        val processedUsers = mutableSetOf<String>()

        for (swipeStep in 0 until maxSwipes) {
            val listForCheck = driver.findElement(AppiumBy.id("com.viber.voip:id/recycler_view"))
            val currentFirstElementText = try {
                listForCheck.findElements(AppiumBy.id("com.viber.voip:id/itemLayout"))
                    .firstOrNull()?.findElement(AppiumBy.id("com.viber.voip:id/name"))?.text
            } catch (e: Exception) { null }

            if (currentFirstElementText != null && currentFirstElementText == previousFirstElementText) {
                sameStateCount++
                if (sameStateCount >= 2) {
                    logger.info("List is not changing on step $swipeStep. Reached the end.")
                    break
                }
            } else {
                sameStateCount = 0
            }
            previousFirstElementText = currentFirstElementText

            var screenProcessed = false
            while (!screenProcessed) {
                val listElement = driver.findElement(AppiumBy.id("com.viber.voip:id/recycler_view"))
                val rows = listElement.findElements(AppiumBy.id("com.viber.voip:id/itemLayout"))
                var clickedInThisPass = false

                for (row in rows) {
                    val name = try {
                        row.findElement(AppiumBy.id("com.viber.voip:id/name")).text
                    } catch (e: Exception) { continue }

                    if (processedUsers.contains(name)) continue

                    if (name.startsWith("Вы ") || name.startsWith("Вы(")){
                        processedUsers.add(name)
                        continue
                    }

                    driver.manage().timeouts().implicitlyWait(Duration.ZERO)
                    val roleBadges = row.findElements(AppiumBy.id("com.viber.voip:id/groupRole"))
                    driver.manage().timeouts().implicitlyWait(Duration.ofSeconds(10))

                    if (roleBadges.isNotEmpty()) {
                        val roleText = roleBadges.first().text
                        if (roleText == "АДМИНИСТРАТОР" || roleText == "СУПЕР-АДМИН") {
                            logger.info("Skipped admin: $name")
                            processedUsers.add(name)
                            continue
                        }
                    }

                    val clickableGroup = row.findElement(AppiumBy.id("com.viber.voip:id/group"))
                    clickableGroup.click()
                    logger.info("Clicked on user: $name")
                    processedUsers.add(name)

                    val isDialogOpen = driver.findElements(AppiumBy.androidUIAutomator("new UiSelector().textContains(\"Сообщение\")")).isNotEmpty()
                    driver.manage().timeouts().implicitlyWait(Duration.ofSeconds(10))
                    if (isDialogOpen) {
                        logger.info("Tapping outside to close.")
                        driver.executeScript("mobile: clickGesture", mapOf("x" to 50, "y" to 150))
                    }
                    clickedInThisPass = true
                    break
                }

                if (!clickedInThisPass) {
                    screenProcessed = true
                }
            }

            val listForScroll = driver.findElement(AppiumBy.id("com.viber.voip:id/recycler_view"))
            val elementId = (listForScroll as? RemoteWebElement)?.id
                ?: throw IllegalStateException("elementId is null")

            val args = mapOf(
                "elementId" to elementId,
                "direction" to "down",
                "percent" to 0.75,
                "speed" to 4000
            )

            driver.executeScript("mobile: scrollGesture", args)
        }
    }


}