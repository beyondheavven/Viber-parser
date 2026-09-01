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

Endpoints: `GET /health`, `POST /api/start`, `GET /api/status`, `POST /api/scroll-members` (body `{ "groupName": "..." }`), `POST /api/stop`, `GET /api/groups`, `GET /api/groups/{id}/members`.

`GET /api/groups` is the exception to the fire-and-forget rule: it reads the device database **synchronously** (one adb run, no Appium session needed) and answers `503` with the underlying error when the device is unreachable. Both database routes live in `plugins/GroupRoutes.kt`; the members route runs **two** queries on purpose — it looks the group up first so a missing group answers `404` instead of an empty list. Their handler and takes its `ViberDatabase` as a parameter defaulting to `DeviceDatabase.viber` — that seam is what lets `GroupRoutesTest` exercise the route with a fake executor instead of a device.

### Global singleton state
`AppiumManager` is a Kotlin `object` (process-wide singleton) holding **the single `AndroidDriver`** and a `@Volatile currentState: ParserState` (`IDLE → INITIALIZING → RUNNING → ERROR`/`IDLE`). There is no lock around the driver — the state machine plus the route-level state checks are the only coordination. Assume automation calls into `AppiumManager` run one at a time; adding genuinely concurrent driver access would need explicit synchronization.

### The `appium/` package (the core)
- `AppiumManager` — session lifecycle (`startSession`/`stopSession`), state, and `executeRootCommand` (runs `mobile: shell` as `su -c`, i.e. **requires a rooted device/emulator** — LDPlayer is rooted out of the box). Capabilities come from `AppiumManager.settings` (`config/AppiumSettings`), not from literals; `noReset` is the only hardcoded one.
- `AdbConnector` — runs `adb connect <udid>` before the session starts, because LDPlayer's network adb target drops after an emulator restart. Never throws: a missing adb only produces a warning.
- `GroupNavigator` — the navigation used by `AppiumManager.scrollMembers` (`openGroup`, `openMembersList`). It relies on **implicit waits** and temporarily lowers the implicit-wait timeout for the "is the group already on screen" fast path before restoring it. Do **not** mix implicit + explicit waits on the same lookup — their timeouts stack unpredictably.
- `MembersScroller.scrollThroughMembers` — pages the member list via `mobile: scrollGesture`, calling back with the visible `WebElement`s each step; detects end-of-list when the first item's text stops changing across iterations.

### The `db/` package — reading Viber's SQLite over adb
A second, independent path to the device that does **not** go through Appium. `AdbSqlite`
runs `adb shell -T "su -c 'echo <base64> | base64 -d | sqlite3 -csv -header \"file:<db>?mode=ro\"'"`.
Each choice there is load-bearing: `shell -T` (not `exec-out`) is the only form that carries
the **exit code** back and keeps stderr separate — `exec-out` reports 0 for a failed query;
base64 keeps the command line free of quotes and newlines, so SQL cannot break the device
shell or Windows argument quoting; `file:...?mode=ro` opens the live database read-only
(`-readonly` does not exist in the sqlite 3.22 shipped with Android 9). Because the exit
code can still be swallowed by some `su` builds, `toRows` also treats an `Error:` line as a
failure. `SqliteCsv` parses the result and deliberately keeps **NULL distinct from `""`**
(sqlite prints NULL as a bare field, `''` as a quoted one).

**Duplicates.** Viber stores one person as two `participants_info` rows — `participant_type = 1`
with the real number and `participant_type = 2` whose `number` is an encrypted value — and
**both are referenced from `participants`**, so an unfiltered member list double-counts (53 rows
for 38 people in a live group). Queries collapse them on `encrypted_member_id`
(`coalesce(nullif(encrypted_member_id,''), member_id, 'row'||_id)` — never on `member_id` alone,
which can itself be the encrypted value), keeping the card with the real phone. sqlite 3.22 on the
device has **no window functions**, so this relies on `max()` + bare columns: sqlite returns the
other columns from the row where the max was reached. Deleting these rows on the device is *not*
an option — both are live foreign keys from `participants`.

`ViberDatabase` holds the typed queries (`groups`, `members`, `membersOfGroup`) over
`conversations` → `participants` → `participants_info`; a group conversation is
`group_id != 0`, `p.active = 1` filters out people who left. The device CLI has **no bound
parameters**, so every string value goes through `quote()` — do not interpolate a string
into these queries any other way. `DeviceDatabase` is the singleton entry point; it takes
the udid and adb path from `AppiumManager.settings` (one device, one source of truth) and
its own `database` yaml section for the path and timeout.

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
