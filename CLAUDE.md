# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Ktor REST **control plane** that drives the **Viber Android app** through **Appium / UiAutomator2** to open a group, open its member list, and scroll through members. The HTTP API only starts/stops and observes automation runs — the actual work happens on a connected Android device/emulator via an external Appium server.

## Commands

Kotlin 2.4.0 · Ktor 3.5.2 · JVM toolchain 21. Use `./gradlew` (or `.\gradlew.bat` on Windows).

- Build (compile + test + fat jar): `./gradlew build`
- Run the server (listens on `:8080`): `./gradlew run`
- Run all tests: `./gradlew test`
- Run a single test (backtick-named): `./gradlew test --tests "com.viber.ServerTest.test root endpoint"`
- Build the shaded jar only: `./gradlew shadowJar` (provided by the Ktor Gradle plugin)

`/api/*` endpoints only do real work when an **Appium server is reachable** (default `http://127.0.0.1:4723`) with an Android device running the Viber app — by default **LDPlayer 9** on the adb bridge `127.0.0.1:5555`. `./gradlew run` alone starts just the HTTP layer. All of it is configurable, see *Device configuration* below.

## Architecture

### Request → automation lifecycle
Routes in `plugins/Routing.kt` are **fire-and-forget**: `/api/start` and `/api/scroll-members` launch a coroutine on `Dispatchers.IO`, respond `202 Accepted` immediately, and only **log** failures — they are never surfaced in the HTTP response. The client observes progress solely through `GET /api/status` and the `ParserState` machine. Routes guard transitions by checking `AppiumManager.currentState` before acting (e.g. `/api/scroll-members` requires `RUNNING`, `/api/start` rejects if already `INITIALIZING`/`RUNNING`).

Endpoints: `GET /health`, `POST /api/start`, `GET /api/status`, `POST /api/scroll-members` (body `{ "groupName": "..." }`), `POST /api/stop`.

### Global singleton state
`AppiumManager` is a Kotlin `object` (process-wide singleton) holding **the single `AndroidDriver`** and a `@Volatile currentState: ParserState` (`IDLE → INITIALIZING → RUNNING → ERROR`/`IDLE`). There is no lock around the driver — the state machine plus the route-level state checks are the only coordination. Assume automation calls into `AppiumManager` run one at a time; adding genuinely concurrent driver access would need explicit synchronization.

### The `appium/` package (the core)
- `AppiumManager` — session lifecycle (`startSession`/`stopSession`), state, and `executeRootCommand` (runs `mobile: shell` as `su -c`, i.e. **requires a rooted device/emulator** — LDPlayer is rooted out of the box). Capabilities come from `AppiumManager.settings` (`config/AppiumSettings`), not from literals; `noReset` is the only hardcoded one.
- `AdbConnector` — runs `adb connect <udid>` before the session starts, because LDPlayer's network adb target drops after an emulator restart. Never throws: a missing adb only produces a warning.
- `GroupNavigator` — the navigation used by `AppiumManager.scrollMembers` (`openGroup`, `openMembersList`). It relies on **implicit waits** and temporarily lowers the implicit-wait timeout for the "is the group already on screen" fast path before restoring it. Do **not** mix implicit + explicit waits on the same lookup — their timeouts stack unpredictably.
- `MembersScroller.scrollThroughMembers` — pages the member list via `mobile: scrollGesture`, calling back with the visible `WebElement`s each step; detects end-of-list when the first item's text stops changing across iterations.

### Selectors are locale- and resource-id-coupled
Element lookups use `AppiumBy.androidUIAutomator` with Viber resource IDs (`com.viber.voip:id/from`, `:id/recycler_view`, `:id/name`, `:id/conversationInfo`, `:id/startText`) **and Russian UI text** (`"участник"`, `"Показать всех"`). Text-based selectors assume the device UI language is **Russian** and break on other locales; resource IDs are tied to a specific Viber build and can drift between app versions.

## Device configuration

Everything device-specific lives in the `appium` section of `src/main/resources/application.yaml` and is read once at startup by `plugins/Appium.kt` (`configureAppium`), which pushes an `AppiumSettings` into the `AppiumManager` singleton. **Do not add capability literals back into `AppiumManager`** — add a key to the yaml section and a field to `AppiumSettings` instead.

Every key uses Ktor's `"$ENV_VAR:default"` substitution, so any value is overridable from the environment without touching the file (`APPIUM_UDID`, `APPIUM_SERVER_URL`, `APPIUM_SYSTEM_PORT`, `ADB_PATH`, ...). Defaults target LDPlayer 9 / Android 9 (API 28): `udid` `127.0.0.1:5555`, `platformVersion` 9. `systemPort` is deliberately **left unset** — pinning it means any orphaned Appium session holding that port blocks every subsequent start with `UiAutomator2 Server cannot start because the local port #N is busy`.

Parsing rules that the tests in `AppiumSettingsTest` pin down: a **missing** key falls back to the LDPlayer default, while a key present but **blank** means "do not send this capability" (so an empty env var cannot silently override a sane default). Booleans use `toBooleanStrictOrNull`.

Running a second LDPlayer instance means overriding both `APPIUM_UDID` (5557, 5559, ...) and `APPIUM_SYSTEM_PORT` (8201, ...) — the UiAutomator2 host port collides otherwise.

`AdbConnector` does not trust `PATH` or `ANDROID_HOME`: Gradle reuses its daemon, so a forked `./gradlew run` inherits the environment of whatever started that daemon, which on this machine has neither. It walks a list of known roots (SDK locations, then the adb LDPlayer ships) before falling back to `PATH`.

## Runtime wiring gotcha
The entry point is `io.ktor.server.netty.EngineMain`, which reads `src/main/resources/application.yaml`. The **effective module list lives in that YAML** (`ktor.application.modules` → `configureRouting`, `configureMonitoring`, `configureSerialization`). `main.kt`'s `Application.module()` duplicates this wiring but is **not referenced by the config**, so editing `main.kt` has no effect on the running server (or on `testApplication`, which also loads the default config) — change `application.yaml` or the `configure*` functions instead.

## Known caveat
`ServerTest."test root endpoint"` is out of sync with the routes: it exercises `GET /`, but the app only serves `/health` and `/api/*`. As a result `./gradlew build` currently fails on this test for reasons unrelated to the Appium logic — treat a red `ServerTest` as pre-existing unless you touched Ktor routing/plugins.
