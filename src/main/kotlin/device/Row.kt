package com.viber.device

/** Строка результата с доступом по имени колонки. */
class Row internal constructor(
    private val columns: List<String>,
    private val values: List<String?>,
) {

    fun string(column: String): String? = values.getOrNull(indexOf(column))

    fun isNull(column: String): Boolean = string(column) == null

    fun long(column: String): Long? = string(column)?.trim()?.takeIf { it.isNotEmpty() }?.toLongOrNull()

    fun int(column: String): Int? = long(column)?.toInt()

    /** sqlite отдаёт флаги как 0/1; NULL и отсутствующее значение считаем false. */
    fun boolean(column: String): Boolean = (long(column) ?: 0L) != 0L

    fun requireString(column: String): String =
        string(column) ?: error("Column '$column' is NULL")

    fun requireLong(column: String): Long =
        long(column) ?: error("Column '$column' is NULL or not a number: ${string(column)}")

    override fun toString(): String = columns.zip(values).toString()

    private fun indexOf(column: String): Int {
        val index = columns.indexOf(column)
        require(index >= 0) { "No column '$column' in result: $columns" }
        return index
    }
}
