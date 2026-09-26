package com.viber.services

import com.viber.clients.AdbClient
import com.viber.models.ViberAccountInfo
import com.viber.models.ViberStartRequest
import com.viber.models.ViberStartResponse
import com.viber.models.ViberStatusResponse

class ViberSystemService(

    private val adbClient: AdbClient
){

    fun startViber(request: ViberStartRequest): ViberStartResponse {
        return try {

            if(request.clearData){
                adbClient.clearApp("com.viber.voip")
            }

            adbClient.startApp("com.viber.voip", "com.viber.voip.WelcomeActivity")
            val pid = adbClient.getPid("com.viber.voip")

            ViberStartResponse(
                success = true,
                message = "Viber запущен",
                pid = pid
            )

        } catch (e: Exception){
            ViberStartResponse(
                success = false,
                message = "Ошибка запуска: ${e.message}"
            )
        }
    }

    fun getViberStatus(): ViberStatusResponse {
        return try {
            val isRunning = adbClient.isAppRunning("com.viber.voip")
            val pid = if (isRunning) adbClient.getPid("com.viber.voip") else null
            val account = adbClient.getAccountInfo()

            ViberStatusResponse(
                isRunning = isRunning,
                pid = pid,
                account = account
            )
        } catch (e: Exception){
            ViberStatusResponse(
                isRunning = false,
                pid = null,
                account = null
            )
        }
    }

    fun getAccountInfo(): ViberAccountInfo {
        return adbClient.getAccountInfo()
    }

}