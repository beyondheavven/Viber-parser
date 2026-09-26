package com.viber.services

import com.viber.clients.ViberBotClient
import com.viber.models.CodeRequest
import com.viber.models.LoginRequest
import com.viber.models.LoginResponse
import com.viber.models.QrStartRequest

class AuthService(
    private val viberBotClient: ViberBotClient,
) {
    suspend fun enterPhoneNumber(request: LoginRequest): LoginResponse {
        return try {
            viberBotClient.enterPhoneNumber(request)
        } catch (e: Exception) {
            LoginResponse(false, "Ошибка: ${e.message}")
        }
    }

    suspend fun enterCode(request: CodeRequest): LoginResponse {
        return try {
            viberBotClient.enterCode(request)
        } catch (e: Exception) {
            LoginResponse(false, "Ошибка: ${e.message}")
        }
    }

    suspend fun getAuthStatus(): String {
        return viberBotClient.getAuthStatus()
    }

    suspend fun startQrLogin(request: QrStartRequest): String {
        return viberBotClient.startQrLogin(request)
    }

    suspend fun getQrLoginStatus(): String {
        return viberBotClient.getQrLoginStatus()
    }

    suspend fun cancelQrLogin(): String {
        return viberBotClient.cancelQrLogin()
    }
}
