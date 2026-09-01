package com.viber.appium

import io.appium.java_client.AppiumBy
import io.appium.java_client.android.AndroidDriver
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
            val viewGroupXPath = "//android.widget.TextView[@text='Показать всех']/parent::android.view.ViewGroup"
            driver.manage().timeouts().implicitlyWait(Duration.ofSeconds(2))
            val visibleButtons = driver.findElements(AppiumBy.xpath(viewGroupXPath))
            driver.manage().timeouts().implicitlyWait(Duration.ofSeconds(10))

            if (visibleButtons.isNotEmpty()) {
                visibleButtons.first().click()
                logger.info("Clicked 'Показать всех' (was already visible)")
                return
            }

            val scrollSelector = "new UiScrollable(new UiSelector().resourceId(\"com.viber.voip:id/conversationInfo\"))" +
                    ".setMaxSearchSwipes(5).scrollIntoView(new UiSelector().text(\"Показать всех\"))"

            driver.findElement(AppiumBy.androidUIAutomator(scrollSelector))
            logger.info("Scrolled to 'Показать всех' text")

            val showAllButtonGroup = driver.findElement(AppiumBy.xpath(viewGroupXPath))
            showAllButtonGroup.click()
            logger.info("Clicked 'Показать всех' after scrolling")
        } catch (e: Exception) {
            logger.error("Could not find or click 'Показать всех' button even after scrolling", e)
            throw IllegalStateException("Button 'Показать всех' not found")
        }
    }

    fun pinGroup(driver: AndroidDriver, groupName: String) {
        val uiSelector = "new UiSelector().resourceId(\"com.viber.voip:id/from\").textContains(\"$groupName\")"

        try {
            val visibleGroup = driver.findElement(AppiumBy.androidUIAutomator(uiSelector))
            val elementId = (visibleGroup as org.openqa.selenium.remote.RemoteWebElement).id
            driver.executeScript("mobile: longClickGesture", mapOf(
                "elementId" to elementId,
                "duration" to 1000
            ))

            driver.manage().timeouts().implicitlyWait(Duration.ofSeconds(2))

            val pinButton = driver.findElements(AppiumBy.androidUIAutomator("new UiSelector().textContains(\"Закрепить\")"))
            if (pinButton.isNotEmpty()) {
                pinButton.first().click()
                logger.info("Group '$groupName' successfully pinned")
            } else {
                logger.info("Group '$groupName' is likely already pinned. Closing context menu.")
                driver.pressKey(io.appium.java_client.android.nativekey.KeyEvent(io.appium.java_client.android.nativekey.AndroidKey.BACK))
            }

        } catch (e: Exception) {
            logger.warn("Could not pin group '$groupName'. It might require scrolling first.", e)
        } finally {
            driver.manage().timeouts().implicitlyWait(Duration.ofSeconds(10))
        }
    }
}