package com.viber.appium.navigation

import io.appium.java_client.AppiumBy

object ViberLocator {
    val RECYCLER_VIEW = AppiumBy.id("com.viber.voip:id/recycler_view")!!
    val ITEM_LAYOUT = AppiumBy.id("com.viber.voip:id/itemLayout")!!
    val USER_NAME = AppiumBy.id("com.viber.voip:id/name")!!
    val VIBER_GROUP = AppiumBy.id("com.viber.voip:id/group")!!
    val USER_GROUP_ROLE = AppiumBy.id("com.viber.voip:id/groupRole")!!
    val MESSAGES_LIST = AppiumBy.id("com.viber.voip:id/messages_list")!!
    val MESSAGE_BUTTON = AppiumBy.androidUIAutomator("new UiSelector().resourceId(\"android:id/title\").textStartsWith(\"Сообщение\")")!!

    val PARTICIPANTS_COUNT = AppiumBy.androidUIAutomator("new UiSelector().textContains(\"участник\")")!!
    val SHOW_ALL_BUTTON_GROUP = AppiumBy.androidUIAutomator("new UiSelector().text(\"Показать всех\")")!!
    val PIN_BUTTON = AppiumBy.androidUIAutomator("new UiSelector().textContains(\"Закрепить чат\")")!!
    val UNPIN_BUTTON = AppiumBy.androidUIAutomator("new UiSelector().textContains(\"Открепить чат\")")!!

    fun groupSelectorByName(name: String): String {
        return "new UiSelector().resourceId(\"com.viber.voip:id/from\").textContains(\"$name\")"
    }
}