package com.viber.db

/**
 * Разбор вывода `sqlite3 -csv -header`.
 *
 * Формат — RFC 4180: поля разделены запятой, значение в кавычках может содержать
 * запятую, перевод строки и удвоенную кавычку. Важная деталь: NULL sqlite печатает
 * как голое пустое поле, а пустую строку — как `""`, поэтому кавычки вокруг поля
 * несут смысл и теряются при наивном split(",").
 */
object SqliteCsv {

    fun parse(output: String): List<Row> {
        val records = parseRecords(output)
        if (records.isEmpty()) return emptyList()

        val header = records.first().map { it ?: "" }
        return records.drop(1).map { Row(header, it) }
    }

    /** null в результате = NULL (поле без кавычек и без символов). */
    private fun parseRecords(output: String): List<List<String?>> {
        val records = mutableListOf<List<String?>>()
        var fields = mutableListOf<String?>()
        val field = StringBuilder()
        var quoted = false
        var inQuotes = false
        var index = 0

        fun endField() {
            fields.add(if (!quoted && field.isEmpty()) null else field.toString())
            field.setLength(0)
            quoted = false
        }

        fun endRecord() {
            endField()
            records.add(fields)
            fields = mutableListOf()
        }

        while (index < output.length) {
            val char = output[index]
            when {
                inQuotes && char == '"' ->
                    // Удвоенная кавычка внутри значения — это одна кавычка, а не конец поля.
                    if (index + 1 < output.length && output[index + 1] == '"') {
                        field.append('"')
                        index++
                    } else {
                        inQuotes = false
                    }

                inQuotes -> field.append(char)

                char == '"' -> {
                    inQuotes = true
                    quoted = true
                }

                char == ',' -> endField()

                char == '\r' -> {
                    if (index + 1 < output.length && output[index + 1] == '\n') index++
                    endRecord()
                }

                char == '\n' -> endRecord()

                else -> field.append(char)
            }
            index++
        }

        // Последняя запись без завершающего перевода строки.
        if (field.isNotEmpty() || quoted || fields.isNotEmpty()) endRecord()

        return records
    }
}

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
