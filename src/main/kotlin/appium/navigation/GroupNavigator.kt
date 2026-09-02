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
import org.openqa.selenium.support.ui.WebDriverWait
import org.slf4j.LoggerFactory
import java.time.Duration

object GroupNavigator {

    private val logger = LoggerFactory.getLogger(GroupNavigator::class.java)

    fun openGroup(driver: AndroidDriver, groupName: String) {
        val uiSelector = groupSelectorByName(groupName)
        val visibleGroup = driver.findElements(AppiumBy.androidUIAutomator(uiSelector))
        if (visibleGroup.isNotEmpty()) {
            visibleGroup.first().click()
            logger.info("Group opened (was already on screen): $groupName")
        } else {
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

        try {
            WebDriverWait(driver, Duration.ofSeconds(5)).until {
                driver.findElements(PARTICIPANTS_COUNT).isNotEmpty()
            }
            logger.info("Confirmed group chat screen opened: $groupName")
        } catch (e: Exception) {
            logger.error("Chat screen for $groupName did not load in time after click", e)
            throw IllegalStateException("Group chat for $groupName did not open (timeout waiting for toolbar)", e)
        }
    }

    fun openMembersList(driver: AndroidDriver) {
        val wait = WebDriverWait(driver, Duration.ofSeconds(5))
        val participantsCountElement = wait.until {
            driver.findElement(PARTICIPANTS_COUNT)
        }

        participantsCountElement.click()
        logger.info("Members list opened")

        val visibleButtons = driver.findElements(SHOW_ALL_BUTTON_GROUP)
        if (visibleButtons.isNotEmpty()) {
            visibleButtons.first().click()
            logger.info("Clicked 'Показать всех' (was already visible)")
            return
        } else {
            try {
                val scrollSelector = "new UiScrollable(new UiSelector().resourceId(\"com.viber.voip:id/conversationInfo\"))" +
                        ".setMaxSearchSwipes(5).scrollIntoView(new UiSelector().text(\"Показать всех\"))"
                driver.findElement(AppiumBy.androidUIAutomator(scrollSelector))
                logger.info("Scrolled to 'Показать всех' text")

                driver.findElement(SHOW_ALL_BUTTON_GROUP).click()
                logger.info("Clicked 'Показать всех' after scrolling")
            } catch (e: Exception) {
                logger.error("Could not find or click 'Показать всех' button even after scrolling", e)
                throw IllegalStateException("Button 'Показать всех' not found")
            }
        }

        try {
            WebDriverWait(driver, Duration.ofSeconds(5)).until {
                driver.findElements(ViberLocator.RECYCLER_VIEW).isNotEmpty()
            }
            logger.info("Confirmed members list (RECYCLER_VIEW) is visible")
        } catch (e: Exception) {
            logger.error("Members list did not appear after clicking 'Показать всех'", e)
            throw IllegalStateException("Members list did not load after 'Показать всех' click", e)
        }
    }

    fun pinGroup(driver: AndroidDriver, groupName: String) {
        val uiSelector = groupSelectorByName(groupName)
        try {
            val visibleGroups = driver.findElements(AppiumBy.androidUIAutomator(uiSelector))
            if (visibleGroups.isEmpty()) {
                logger.warn("Group '$groupName' not visible for pinning on main screen. Skipping pin.")
                return
            }

            val elementId = (visibleGroups.first() as RemoteWebElement).id
            driver.executeScript("mobile: longClickGesture", mapOf(
                "elementId" to elementId,
                "duration" to 1000
            ))

            val wait = WebDriverWait(driver, Duration.ofSeconds(5))
            try {
                wait.until {
                    driver.findElements(PIN_BUTTON).isNotEmpty() || driver.findElements(UNPIN_BUTTON).isNotEmpty()
                }
            } catch (e: Exception) {
                logger.warn("Context menu did not appear. Closing. " + e.message)
                driver.pressKey(KeyEvent(AndroidKey.BACK))
                return
            }

            val pinButtons = driver.findElements(PIN_BUTTON)
            if (pinButtons.isNotEmpty()) {
                pinButtons.first().click()
                logger.info("Group '$groupName' successfully pinned")
            } else {
                val unpinButton = driver.findElement(UNPIN_BUTTON)
                if (unpinButton != null) {
                    logger.info("Group '$groupName' is likely already pinned. Closing context menu.")
                } else {
                    logger.warn("Unexpected menu state for '$groupName' (neither Pin nor Unpin found). Closing.")
                }
                driver.executeScript("mobile: clickGesture", mapOf("x" to 50, "y" to 150))
            }
        } catch (e: Exception) {
            logger.warn("Could not pin group '$groupName'. It might require scrolling first.", e)
        }
    }
}