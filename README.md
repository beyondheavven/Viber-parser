# Viber-parser

This project was created using the [Ktor Project Generator](https://start.ktor.io).

Here are some useful links to get you started:

* [Ktor Documentation](https://ktor.io/docs/home.html)
* [Ktor GitHub page](https://github.com/ktorio/ktor)
* [Ktor Slack chat](https://app.slack.com/client/T09229ZC6/C0A974TJ9). [Request an invite](https://surveys.jetbrains.com/s3/kotlin-slack-sign-up).

## Features

Here's a list of features included in this project:

| Name | Description |
|------|-------------|

## Building & Running

To build or run the project, use one of the following tasks:

| Task              | Description       |
|-------------------|-------------------|
| `./gradlew test`  | Run the tests     |
| `./gradlew build` | Build the project |
| `./gradlew run`   | Run the server    |

If the server starts successfully, you'll see the following output:

```
2024-12-04 14:32:45.584 [main] INFO  Application - Application started in 0.303 seconds.
2024-12-04 14:32:45.682 [main] INFO  Application - Responding at http://0.0.0.0:8080
```

## LDPlayer + Appium

The API only drives a real device. Default target: **LDPlayer 9** (Android 9 / API 28), reachable over the adb bridge on `127.0.0.1:5555`.

### 1. LDPlayer

Enable ADB debugging in the emulator: *Settings → Other settings → ADB debugging → **Open local connection***, then restart the instance. Check it from the host:

```bash
adb connect 127.0.0.1:5555
adb devices -l
```

A second instance answers on `5557`, a third on `5559`, and so on.

### 2. Appium

Start an Appium server with the UiAutomator2 driver (default port 4723):

```bash
appium
```

### 3. The app

```bash
./gradlew run
```

On startup the resolved device configuration is logged as `Appium settings: ...`, and the chosen adb binary is logged when a session starts — check those lines first when a session fails to start. `POST /api/start` runs `adb connect <udid>` itself before creating the session, so a restarted emulator does not need manual reconnecting.

### Configuration

Defaults live in the `appium` section of `src/main/resources/application.yaml`; every one of them is overridable through an environment variable.

| Variable | Default | Meaning |
|---|---|---|
| `APPIUM_SERVER_URL` | `http://127.0.0.1:4723` | Appium server endpoint |
| `APPIUM_UDID` | `127.0.0.1:5555` | adb target of the LDPlayer instance |
| `APPIUM_DEVICE_NAME` | `LDPlayer` | Cosmetic device name |
| `APPIUM_PLATFORM_VERSION` | `9` | Android version of the instance |
| `APPIUM_APP_PACKAGE` | `com.viber.voip` | Package under automation |
| `APPIUM_APP_ACTIVITY` | `com.viber.voip.WelcomeActivity` | Launch activity |
| `APPIUM_SYSTEM_PORT` | *(unset)* | Host port of the UiAutomator2 server. Unset lets Appium pick a free one; set it only for parallel instances |
| `APPIUM_NEW_COMMAND_TIMEOUT_SECONDS` | `300` | Idle timeout of the session |
| `APPIUM_IMPLICIT_WAIT_SECONDS` | `10` | Implicit wait |
| `APPIUM_ADB_EXEC_TIMEOUT_SECONDS` | `60` | adb command timeout |
| `APPIUM_SERVER_LAUNCH_TIMEOUT_SECONDS` | `120` | UiAutomator2 server launch timeout |
| `APPIUM_AUTO_CONNECT_ADB` | `true` | Run `adb connect` before starting a session |
| `ADB_PATH` | *(empty)* | adb binary; empty searches `ANDROID_HOME`/`ANDROID_SDK_ROOT`/`%LOCALAPPDATA%\Android\Sdk` platform-tools, then the adb LDPlayer ships, then `PATH` |

Driving two instances at once:

```bash
APPIUM_UDID=127.0.0.1:5557 APPIUM_SYSTEM_PORT=8201 ./gradlew run
```

### Troubleshooting

- **`ConnectException` / `invalid address of the remote server`** — no Appium server on `APPIUM_SERVER_URL`. Check with `curl http://127.0.0.1:4723/status`.
- **`UiAutomator2 Server cannot start because the local port #N is busy`** — an orphaned session from an earlier run still holds that port. List them with `curl http://127.0.0.1:4723/sessions` and close the stale one with `curl -X DELETE http://127.0.0.1:4723/session/<id>`. This is why `APPIUM_SYSTEM_PORT` is left unset by default.
- **`Cannot run program "adb"`** — no adb binary was found in any known location; point `ADB_PATH` at one (e.g. `C:/LDPlayer/LDPlayer9/adb.exe`). The session still starts, only the pre-flight `adb connect` is skipped.
