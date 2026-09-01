package com.viber.appium

/**
 * Всё, чем мы цепляемся за интерфейс Viber, — в одном месте.
 *
 * Это самая хрупкая часть проекта, и хрупкая она двумя разными способами:
 *
 * - **resource-id** (`com.viber.voip:id/...`) привязаны к конкретной сборке Viber и
 *   расходятся между версиями приложения;
 * - **тексты** (`участник`, `Показать всех`) предполагают, что язык интерфейса на
 *   устройстве — **русский**, и на другой локали не находят ничего.
 *
 * Собранные вместе, они дают одно место для правки, когда Viber обновился или устройство
 * оказалось не с той локалью. Разложенные по сценариям, они заставляли бы искать причину
 * по всем файлам сразу.
 */
object ViberSelectors {

    /** Название беседы в списке чатов. */
    const val CHAT_TITLE_ID = "com.viber.voip:id/from"

    /** Сам список чатов — системный, поэтому `android:id`, а не `com.viber.voip:id`. */
    const val CHAT_LIST_ID = "android:id/list"

    /** Экран «о беседе», по которому скроллим до кнопки со списком участников. */
    const val CONVERSATION_INFO_ID = "com.viber.voip:id/conversationInfo"

    /** Кнопка «Показать всех» на экране беседы. */
    const val SHOW_ALL_ID = "com.viber.voip:id/startText"

    /** Список участников. */
    const val MEMBER_LIST_ID = "com.viber.voip:id/recycler_view"

    /** Имя участника внутри строки списка. */
    const val MEMBER_NAME_ID = "com.viber.voip:id/name"

    /** Строка «N участников» — по ней открывается список. Только для русской локали. */
    const val MEMBERS_COUNT_TEXT = "участник"

    /** Точное совпадение по resource-id. */
    fun byId(resourceId: String): String = "new UiSelector().resourceId(\"$resourceId\")"

    /** Элемент с нужным resource-id, чей текст содержит [text]. */
    fun byIdContainingText(resourceId: String, text: String): String =
        "new UiSelector().resourceId(\"$resourceId\").textContains(\"$text\")"

    /** Элемент, чей текст содержит [text], — без привязки к id. */
    fun byText(text: String): String = "new UiSelector().textContains(\"$text\")"

    /**
     * Прокрутка контейнера [containerId] до тех пор, пока в него не попадёт [target].
     * UiScrollable листает сам, поэтому свои жесты здесь не нужны.
     */
    fun scrollInto(containerId: String, target: String): String =
        "new UiScrollable(${byId(containerId)}).scrollIntoView($target)"
}
