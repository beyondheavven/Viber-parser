package com.viber.services

import com.viber.clients.FridaClient
import com.viber.models.CodeRequest
import com.viber.models.LoginRequest
import com.viber.models.LoginResponse

class AuthService(
    private val fridaClient: FridaClient,
) {

    fun enterPhoneNumber(request: LoginRequest): LoginResponse {
        return try {
            val result = fridaClient.enterPhoneNumber(request.phoneNumber)
            if (result.success) {
                fridaClient.clickButton("Продолжить")
                LoginResponse(true, "Номер введён")
            } else {
                LoginResponse(false, "Ошибка: ${result.error}")
            }
        } catch (e: Exception) {
            LoginResponse(false, "Ошибка: ${e.message}")
        }
    }

    fun enterCode(request: CodeRequest): LoginResponse {
        return try {
            val result = fridaClient.enterCode(request.code)
            if (result.success) {
                fridaClient.clickButton("Подтвердить")
                LoginResponse(true, "Код введён")
            } else {
                LoginResponse(false, "Ошибка: ${result.error}")
            }
        } catch (e: Exception) {
            LoginResponse(false, "Ошибка: ${e.message}")
        }
    }
}