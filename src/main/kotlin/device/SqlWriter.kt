package com.viber.device

interface SqlWriter {
    fun execute(statements: List<String>, restartApp: Boolean = true): WriteResult
}

data class WriteResult(val changedRows: Int?, val backupPath: String?)
