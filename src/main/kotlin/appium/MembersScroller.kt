package com.viber.appium

import io.appium.java_client.android.AndroidDriver
import org.openqa.selenium.By
import org.openqa.selenium.WebElement
import org.openqa.selenium.remote.RemoteWebElement
import org.slf4j.LoggerFactory

object MembersScroller {

    private val logger = LoggerFactory.getLogger(MembersScroller::class.java)

    fun scrollThroughMembers(
        driver: AndroidDriver,
        maxSwipes: Int = 100,
        onScreen: (List<WebElement>) -> Unit,
    ){
        var previousFirstElementText: String? = null
        var sameStateCount = 0

        for (i in 0 until maxSwipes) {
            val listElement = try {
                driver.findElement(By.id(ViberSelectors.MEMBER_LIST_ID))
            } catch (e: Exception) {
                logger.error("Can not find list of users on step $i", e)
                throw e
            }

            val visibleItems = listElement.findElements(By.id(ViberSelectors.MEMBER_NAME_ID))
            logger.debug("Step $i: can see ${visibleItems.size} elements")
            onScreen(visibleItems)

            val currentFirstText = visibleItems.firstOrNull()?.text
            if (currentFirstText == previousFirstElementText) {
                sameStateCount++
                if (sameStateCount >= 2) {
                    logger.info("List is not changing on step $i")
                    break
                }
            } else {
                sameStateCount = 0
            }
            previousFirstElementText = currentFirstText

            val elementId = (listElement as? RemoteWebElement)?.id
                ?: run {
                    logger.error("Can not get id of an element on step $i")
                    throw IllegalStateException("elementId is null")
                }

            val args = mapOf(
                "elementId" to elementId,
                "direction" to "down",
                "percent" to 0.75,
                "speed" to 4000,
            )

            try {
                driver.executeScript("mobile: scrollGesture", args)
            } catch (e: Exception) {
                logger.error("Error while scrolling on step $i", e)
                throw e
            }

            Thread.sleep(400)
        }
    }


}