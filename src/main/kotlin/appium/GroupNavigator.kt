package com.viber.appium

import io.appium.java_client.AppiumBy
import io.appium.java_client.android.AndroidDriver
import org.openqa.selenium.By
import org.slf4j.LoggerFactory

object GroupNavigator {

    private val logger = LoggerFactory.getLogger(GroupNavigator::class.java)

    fun openGroup(driver: AndroidDriver, groupName: String) {

        val selector = """
            new UiScrollable(new UiSelector().resourceId("android:id/list"))
                .scrollIntoView(
                    new UiSelector()
                        .resourceId("com.viber.voip:id/from")
                        .textContains("$groupName")
                )
        """.trimIndent()

        val groupItem = try {
            driver.findElement(AppiumBy.androidUIAutomator(selector))
        }catch (e:Exception){
            logger.error("Group with name $groupName not found", e)
            throw IllegalStateException("Group with name $groupName not found")
        }

        groupItem.click()
        logger.info("Group opened: $groupName")
    }

    fun openMembersList(driver: AndroidDriver) {
        val participantsCountElement = driver.findElement(
            AppiumBy.androidUIAutomator("""
                new UiSelector().textContains("участник")
            """)
        )

        participantsCountElement.click()
        logger.info("Members list opened: $participantsCountElement")

        val showAllButton = driver.findElement(By.id("com.viber.voip:id/startText"))
        showAllButton.click()
        logger.info("Clicked 'Показать всех'")
    }
}