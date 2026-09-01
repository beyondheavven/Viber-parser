package com.viber.appium

import io.appium.java_client.AppiumBy
import io.appium.java_client.android.AndroidDriver
import org.openqa.selenium.By
import org.slf4j.LoggerFactory
import java.time.Duration

object GroupNavigator {

    private val logger = LoggerFactory.getLogger(GroupNavigator::class.java)

    fun openGroup(driver: AndroidDriver, groupName: String) {
        val uiSelector = "new UiSelector().resourceId(\"com.viber.voip:id/from\").textContains(\"$groupName\")"

        driver.manage().timeouts().implicitlyWait(Duration.ofSeconds(1))

        try {
            val visibleGroup = driver.findElement(AppiumBy.androidUIAutomator(uiSelector))
            visibleGroup.click()
            logger.info("Group opened (was already on screen): $groupName")
            return
        } catch (e: Exception) {
            logger.info("Group not immediately visible, starting scroll...")
        } finally {
            driver.manage().timeouts().implicitlyWait(Duration.ofSeconds(10))
        }

        try {
            val scrollSelector = "new UiScrollable(new UiSelector().resourceId(\"android:id/list\"))" +
                    ".scrollIntoView($uiSelector)"

            val scrolledGroup = driver.findElement(AppiumBy.androidUIAutomator(scrollSelector))
            scrolledGroup.click()
            logger.info("Group opened after scrolling: $groupName")

        } catch (e: Exception) {
            logger.error("Group with name $groupName not found even after scrolling", e)
            throw IllegalStateException("Group with name $groupName not found")
        }
    }

    fun openMembersList(driver: AndroidDriver) {
        val participantsCountElement = driver.findElement(
            AppiumBy.androidUIAutomator("new UiSelector().textContains(\"участник\")")
        )
        participantsCountElement.click()
        logger.info("Members list opened")

        try {
            val scrollSelector = "new UiScrollable(new UiSelector().resourceId(\"com.viber.voip:id/conversationInfo\"))" +
                    ".scrollIntoView(new UiSelector().resourceId(\"com.viber.voip:id/startText\"))"

            val showAllButton = driver.findElement(AppiumBy.androidUIAutomator(scrollSelector))
            showAllButton.click()
            logger.info("Clicked 'Показать всех'")

        } catch (e: Exception) {
            logger.error("Could not find 'Показать всех' button even after scrolling", e)
            throw IllegalStateException("Button 'Показать всех' not found")
        }
    }
}