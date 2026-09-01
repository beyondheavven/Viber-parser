package com.viber.appium

import io.appium.java_client.AppiumBy
import io.appium.java_client.android.AndroidDriver
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

                    driver.manage().timeouts().implicitlyWait(Duration.ZERO)
                    val adminBadge = row.findElements(AppiumBy.xpath(
                        ".//android.widget.TextView[@text='АДМИНИСТРАТОР' or @text='СУПЕР-АДМИН']"
                    ))
                    driver.manage().timeouts().implicitlyWait(Duration.ofSeconds(10))

                    if (adminBadge.isNotEmpty()) {
                        processedUsers.add(name)
                        continue
                    }

                    val clickableGroup = row.findElement(AppiumBy.id("com.viber.voip:id/group"))
                    clickableGroup.click()
                    logger.info("Clicked on user: $name")
                    processedUsers.add(name)
                    driver.navigate().back()

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