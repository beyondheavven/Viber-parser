package com.viber.device

import com.viber.appium.AppiumManager
import com.viber.config.DatabaseSettings
import org.slf4j.LoggerFactory

/**
 * Точка доступа к базе Viber на устройстве.
 *
 * Адрес устройства берём из [AppiumManager]: телефон один и тот же, что и для Appium,
 * поэтому udid и путь к adb не дублируются в конфиге. Клиент создаётся на каждый вызов —
 * он не держит соединение, вся работа это один запуск adb.
 */
object DeviceDatabase {

    private val logger = LoggerFactory.getLogger(DeviceDatabase::class.java)

    @Volatile
    var settings: DatabaseSettings = DatabaseSettings()
        private set

    fun configure(newSettings: DatabaseSettings) {
        settings = newSettings
        logger.info("Database settings: ${newSettings.describe()}")
    }

    /** Типизированные выборки: группы и их участники. */
    val viber: ViberDatabase get() = ViberDatabase(executor())

    /** Для произвольного SELECT — когда типизированной выборки ещё нет. */
    fun executor(): SqlExecutor {
        val device = AppiumManager.settings
        val udid = device.udid
            ?: error("No device udid configured — set appium.udid (APPIUM_UDID) to reach the database")

        return AdbSqlite(
            udid = udid,
            adbPath = device.adbPath,
            databasePath = settings.databasePath,
            timeout = settings.queryTimeout,
        )
    }
}
