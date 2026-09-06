package com.viber.services

import com.viber.clients.AdbClient
import com.viber.models.CodeRequest
import com.viber.models.LoginRequest
import com.viber.models.LoginResponse

class AuthService(
    private val adbClient: AdbClient,
) {

    fun enterPhoneNumber(request: LoginRequest): LoginResponse {
        return try {
            adbClient.exec("shell input text ${request.phoneNumber}")
            adbClient.exec("shell input keyevent 66")
            LoginResponse(true, "Номер отправлен (заглушка ADB)")
        } catch (e: Exception) {
            LoginResponse(false, "Ошибка: ${e.message}")
        }
    }

    fun enterCode(request: CodeRequest): LoginResponse {
        return try {
            adbClient.exec("shell input text ${request.code}")
            adbClient.exec("shell input keyevent 66")
            LoginResponse(true, "Код подтвержден (заглушка ADB)")
        } catch (e: Exception) {
            LoginResponse(false, "Ошибка: ${e.message}")
        }
    }
}