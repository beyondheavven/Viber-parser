package com.viber.appium

import io.appium.java_client.AppiumBy
import io.appium.java_client.android.AndroidDriver
import org.slf4j.LoggerFactory
import java.time.Duration

/**
 * Навигация до списка участников: открыть группу, открыть её участников.
 *
 * Держится на **неявных ожиданиях** драйвера. Смешивать их с явными (`WebDriverWait`) на
 * одном и том же поиске нельзя — таймауты складываются непредсказуемо.
 *
 * Селекторы — в [ViberSelectors].
 */
object GroupNavigator {

    private val logger = LoggerFactory.getLogger(GroupNavigator::class.java)

    /** Насколько укорачиваем ожидание для быстрой проверки «группа уже на экране». */
    private val GLANCE_TIMEOUT: Duration = Duration.ofSeconds(1)

    /** Штатное неявное ожидание, к которому возвращаемся. */
    private val DEFAULT_TIMEOUT: Duration = Duration.ofSeconds(10)

    fun openGroup(driver: AndroidDriver, groupName: String) {
        val groupSelector = ViberSelectors.byIdContainingText(ViberSelectors.CHAT_TITLE_ID, groupName)

        // Быстрый путь: если группа уже видна, десять секунд ждать незачем.
        driver.manage().timeouts().implicitlyWait(GLANCE_TIMEOUT)
        try {
            driver.findElement(AppiumBy.androidUIAutomator(groupSelector)).click()
            logger.info("Group opened (was already on screen): $groupName")
            return
        } catch (e: Exception) {
            logger.info("Group not immediately visible, starting scroll...")
        } finally {
            driver.manage().timeouts().implicitlyWait(DEFAULT_TIMEOUT)
        }

        try {
            val scrollSelector = ViberSelectors.scrollInto(ViberSelectors.CHAT_LIST_ID, groupSelector)
            driver.findElement(AppiumBy.androidUIAutomator(scrollSelector)).click()
            logger.info("Group opened after scrolling: $groupName")
        } catch (e: Exception) {
            logger.error("Group with name $groupName not found even after scrolling", e)
            throw IllegalStateException("Group with name $groupName not found")
        }
    }

    fun openMembersList(driver: AndroidDriver) {
        driver.findElement(
            AppiumBy.androidUIAutomator(ViberSelectors.byText(ViberSelectors.MEMBERS_COUNT_TEXT))
        ).click()
        logger.info("Members list opened")

        try {
            val scrollSelector = ViberSelectors.scrollInto(
                ViberSelectors.CONVERSATION_INFO_ID,
                ViberSelectors.byId(ViberSelectors.SHOW_ALL_ID),
            )
            driver.findElement(AppiumBy.androidUIAutomator(scrollSelector)).click()
            logger.info("Clicked 'Показать всех'")
        } catch (e: Exception) {
            logger.error("Could not find 'Показать всех' button even after scrolling", e)
            throw IllegalStateException("Button 'Показать всех' not found")
        }
    }
}
