package com.viber.appium.navigation

import io.appium.java_client.AppiumBy

object ViberLocator {
    val RECYCLER_VIEW = AppiumBy.id("com.viber.voip:id/recycler_view")
    val ITEM_LAYOUT = AppiumBy.id("com.viber.voip:id/itemLayout")
    val NAME = AppiumBy.id("com.viber.voip:id/name")
    val GROUP = AppiumBy.id("com.viber.voip:id/group")
    val GROUP_ROLE = AppiumBy.id("com.viber.voip:id/groupRole")
    val MESSAGES_LIST = AppiumBy.id("com.viber.voip:id/messages_list")
    val MESSAGE_BUTTON = AppiumBy.androidUIAutomator("new UiSelector().resourceId(\"android:id/title\").textStartsWith(\"Сообщение\")")
    val DIALOG_CHECK = AppiumBy.androidUIAutomator("new UiSelector().textContains(\"Сообщение\")")

}