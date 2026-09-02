package com.viber.appium.navigation

import com.viber.appium.navigation.ViberLocator.PARTICIPANTS_COUNT
import com.viber.appium.navigation.ViberLocator.PIN_BUTTON
import com.viber.appium.navigation.ViberLocator.SHOW_ALL_BUTTON_GROUP
import com.viber.appium.navigation.ViberLocator.UNPIN_BUTTON
import com.viber.appium.navigation.ViberLocator.groupSelectorByName
import io.appium.java_client.AppiumBy
import io.appium.java_client.android.AndroidDriver
import io.appium.java_client.android.nativekey.AndroidKey
import io.appium.java_client.android.nativekey.KeyEvent
import org.openqa.selenium.remote.RemoteWebElement
import org.slf4j.LoggerFactory
import java.time.Duration

object GroupNavigator {

    private val logger = LoggerFactory.getLogger(GroupNavigator::class.java)

    fun openGroup(driver: AndroidDriver, groupName: String) {
        val uiSelector = groupSelectorByName(groupName)
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
        val participantsCountElement = driver.findElement(PARTICIPANTS_COUNT)
        participantsCountElement.click()
        logger.info("Members list opened")

        try {
            driver.manage().timeouts().implicitlyWait(Duration.ofSeconds(2))
            val visibleButtons = driver.findElements(SHOW_ALL_BUTTON_GROUP)
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

            val showAllButtonGroup = driver.findElement(SHOW_ALL_BUTTON_GROUP)
            showAllButtonGroup.click()
            logger.info("Clicked 'Показать всех' after scrolling")
        } catch (e: Exception) {
            logger.error("Could not find or click 'Показать всех' button even after scrolling", e)
            throw IllegalStateException("Button 'Показать всех' not found")
        }
    }

    fun pinGroup(driver: AndroidDriver, groupName: String) {
        val uiSelector = groupSelectorByName(groupName)
        try {
            val visibleGroup = driver.findElement(AppiumBy.androidUIAutomator(uiSelector))
            val elementId = (visibleGroup as RemoteWebElement).id
            driver.executeScript("mobile: longClickGesture", mapOf(
                "elementId" to elementId,
                "duration" to 1000
            ))

            driver.manage().timeouts().implicitlyWait(Duration.ofSeconds(2))

            val pinButton = driver.findElements(PIN_BUTTON)
            if (pinButton.isNotEmpty()) {
                pinButton.first().click()
                logger.info("Group '$groupName' successfully pinned")
            } else {
                val unpinButton = driver.findElement(UNPIN_BUTTON)
                if (unpinButton != null) {
                    logger.info("Group '$groupName' is likely already pinned. Closing context menu.")
                } else {
                    logger.warn("Unexpected menu state for '$groupName' (neither Pin nor Unpin found). Closing.")
                }
                driver.pressKey(KeyEvent(AndroidKey.BACK))
            }
        } catch (e: Exception) {
            logger.warn("Could not pin group '$groupName'. It might require scrolling first.", e)
        } finally {
            driver.manage().timeouts().implicitlyWait(Duration.ofSeconds(10))
        }
    }
}