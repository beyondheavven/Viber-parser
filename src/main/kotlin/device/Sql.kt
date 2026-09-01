package com.viber.device

/**
 * Единственный способ внести строку в запрос к устройству.
 *
 * Устройский sqlite3 мы гоняем как CLI — связанных параметров там нет, значение попадает
 * в SQL текстом. Удвоенная кавычка — экранирование sqlite.
 */
internal fun quote(value: String): String = "'" + value.replace("'", "''") + "'"
