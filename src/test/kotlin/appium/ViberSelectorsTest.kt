package com.viber.appium

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class ViberSelectorsTest {

    @Test
    fun `matches an element by its resource id`() {
        assertEquals(
            "new UiSelector().resourceId(\"com.viber.voip:id/name\")",
            ViberSelectors.byId(ViberSelectors.MEMBER_NAME_ID),
        )
    }

    @Test
    fun `matches a chat by the title shown in the list`() {
        val selector = ViberSelectors.byIdContainingText(ViberSelectors.CHAT_TITLE_ID, "Моя группа")

        assertEquals(
            "new UiSelector().resourceId(\"com.viber.voip:id/from\").textContains(\"Моя группа\")",
            selector,
        )
    }

    @Test
    fun `scrolls a container until the target comes into view`() {
        val target = ViberSelectors.byId(ViberSelectors.SHOW_ALL_ID)

        val selector = ViberSelectors.scrollInto(ViberSelectors.CONVERSATION_INFO_ID, target)

        assertEquals(
            "new UiScrollable(new UiSelector().resourceId(\"com.viber.voip:id/conversationInfo\"))" +
                ".scrollIntoView(new UiSelector().resourceId(\"com.viber.voip:id/startText\"))",
            selector,
        )
    }

    @Test
    fun `keeps the chat list on the framework id, not on a Viber one`() {
        // Список чатов рисует сам Android, поэтому android:id — подставив сюда
        // com.viber.voip:id, поиск перестанет находить что-либо вообще.
        assertEquals("android:id/list", ViberSelectors.CHAT_LIST_ID)
    }

    @Test
    fun `pins the Viber resource ids the automation hangs on`() {
        // Эти id принадлежат конкретной сборке Viber. Тест не проверяет устройство —
        // он делает список явным, чтобы после обновления приложения было видно, что менять.
        listOf(
            ViberSelectors.CHAT_TITLE_ID to "com.viber.voip:id/from",
            ViberSelectors.CONVERSATION_INFO_ID to "com.viber.voip:id/conversationInfo",
            ViberSelectors.SHOW_ALL_ID to "com.viber.voip:id/startText",
            ViberSelectors.MEMBER_LIST_ID to "com.viber.voip:id/recycler_view",
            ViberSelectors.MEMBER_NAME_ID to "com.viber.voip:id/name",
        ).forEach { (actual, expected) -> assertEquals(expected, actual) }
    }

    @Test
    fun `looks for the members count by Russian text`() {
        // Текстовый поиск предполагает русскую локаль устройства — на другой он не найдёт
        // ничего, и падение будет выглядеть как «кнопки нет», а не как «не тот язык».
        assertEquals("участник", ViberSelectors.MEMBERS_COUNT_TEXT)
        assertTrue(ViberSelectors.byText("участник").contains("textContains(\"участник\")"))
    }
}
