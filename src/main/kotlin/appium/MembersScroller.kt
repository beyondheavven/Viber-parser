package com.viber.appium

import io.appium.java_client.android.AndroidDriver
import org.openqa.selenium.By
import org.openqa.selenium.WebElement
import org.openqa.selenium.remote.RemoteWebElement

object MembersScroller {

    fun scrollThroughMembers(
        driver: AndroidDriver,
        listResourceId: String,
        onScreen: (List<WebElement>) -> Unit,
        maxSwipes: Int = 100
    ){
        var previousFirstElementText: String? = null
        var sameStateCount = 0

        repeat(maxSwipes){ step ->
            val listElement = driver.findElement(By.id(listResourceId))
            val visibleItems = listElement.findElements(By.id("com.viber.voip:id/member_name"))
            onScreen(visibleItems)

            val currentFirstText = visibleItems.firstOrNull()?.text
            if(currentFirstText == previousFirstElementText){
                sameStateCount++
                if(sameStateCount >= 2) return@repeat
            } else {
                sameStateCount = 0
            }
            previousFirstElementText = currentFirstText

            val elementId = (listElement as? RemoteWebElement)?.id?: throw IllegalStateException("Element not found")
            val args = mapOf(
                "elementId" to elementId,
                "direction" to "down",
                "percent" to 0.75,
                "speed" to 4000,
            )

            driver.executeScript("mobile: scrollGesture", args)
            Thread.sleep(500)
        }
    }


}