package com.viber.device

import com.viber.device.sqlite.Row

/** Источник строк для типизированных запросов — отделён от adb, чтобы репозитории тестировались без устройства. */
fun interface SqlExecutor {
    fun query(sql: String): List<Row>
}
