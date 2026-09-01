# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Ktor REST **control plane** that drives the **Viber Android app** through **Appium / UiAutomator2** to open a group, open its member list, and scroll through members. The HTTP API only starts/stops and observes automation runs — the actual work happens on a connected Android device/emulator via an external Appium server.

## Commands

Kotlin 2.4.0 · Ktor 3.5.2 · JVM toolchain 21. Use `./gradlew` (or `.\gradlew.bat` on Windows).

- Build (compile + test + fat jar): `./gradlew build`
- Run the server (listens on `:8080`): `./gradlew run`
- Run all tests: `./gradlew test`
- Run a single test (backtick-named): `./gradlew test --tests "com.viber.SqliteCsvTest.parses a header and rows addressed by column name"`
- Build the shaded jar only: `./gradlew shadowJar` (provided by the Ktor Gradle plugin)

`/api/*` endpoints only do real work when an **Appium server is reachable** (default `http://127.0.0.1:4723`) with an Android device running the Viber app — by default **LDPlayer 9** on the adb bridge `127.0.0.1:5555`. `./gradlew run` alone starts just the HTTP layer. All of it is configurable, see *Device configuration* below.

## Architecture

### Request → automation lifecycle
Routes live in `routes/`, Ktor wiring in `plugins/` — `plugins/` installs things, `routes/`
answers requests. `routes/Routing.kt` is only the table; each group of handlers sits in its own
file (`SessionRoutes`, `GroupRoutes`, `ParticipantRoutes`).

The session routes in `routes/SessionRoutes.kt` are **fire-and-forget**: `/api/start` and `/api/scroll-members` launch a coroutine on **the application's** scope (`call.application.launch(Dispatchers.IO)` — the work has to outlive the request that started it), respond `202 Accepted` immediately, and only **log** failures — they are never surfaced in the HTTP response. The client observes progress solely through `GET /api/status` and the `ParserState` machine. Routes guard transitions by checking `AppiumManager.currentState` before acting (e.g. `/api/scroll-members` requires `RUNNING`, `/api/start` rejects if already `INITIALIZING`/`RUNNING`).

Endpoints: `GET /health`, `POST /api/start`, `GET /api/status`, `POST /api/scroll-members` (body `{ "groupName": "..." }`), `POST /api/stop`, `GET /api/groups`, `GET /api/groups/{id}/members`, `POST /api/participants/decode`.

The **database routes are the exception** to the fire-and-forget rule: they hit the device **synchronously** (one adb run, no Appium session needed) and answer `503` with the underlying error when the device is unreachable. `onDevice`/`respondDeviceFailure` in `routes/DeviceRouting.kt` is the shared shape of that — every synchronous device route goes through it. The read routes live in `routes/GroupRoutes.kt`; the members route runs **two** queries on purpose — it looks the group up first so a missing group answers `404` instead of an empty list. Their handler takes its `ViberDatabase` as a parameter defaulting to `DeviceDatabase.viber` — that seam is what lets `GroupRoutesTest` exercise the route with a fake executor instead of a device.

`POST /api/participants/decode` (`routes/ParticipantRoutes.kt`) is the **only route that writes**. Body is optional — no body means defaults — and takes `dryRun`, `includeSelf`, `limit`, `restartApp`; a body that is present but unparseable is a `400` on purpose, so a typo in an option cannot silently rewrite the whole table. It refuses with `409` while an Appium session is `INITIALIZING`/`RUNNING`, because writing force-stops Viber and would yank the app out from under the automation — a dry run is allowed at any time. Both the decoder and the session state arrive as parameters, which is what lets `ParticipantRoutesTest` drive it with fakes.

### Global singleton state
`AppiumManager` is a Kotlin `object` (process-wide singleton) holding **the single `AndroidDriver`** and a `@Volatile currentState: ParserState` (`IDLE → INITIALIZING → RUNNING → ERROR`/`IDLE`). There is no lock around the driver — the state machine plus the route-level state checks are the only coordination. Assume automation calls into `AppiumManager` run one at a time; adding genuinely concurrent driver access would need explicit synchronization.

### The `appium/` package (the core)
- `AppiumManager` — session lifecycle (`startSession`/`stopSession`), state, and the `scrollMembers` orchestration. Capabilities come from `AppiumManager.settings` (`config/AppiumSettings`), not from literals; `noReset` is the only hardcoded one. It no longer carries a `mobile: shell` helper — the device is reached through `device/`, and a second road to the same root shell would only drift from the first.
- `AdbConnector` — runs `adb connect <udid>` before the session starts, because LDPlayer's network adb target drops after an emulator restart. Never throws: a missing adb only produces a warning.
- `GroupNavigator` — the navigation used by `AppiumManager.scrollMembers` (`openGroup`, `openMembersList`). It relies on **implicit waits** and temporarily lowers the implicit-wait timeout for the "is the group already on screen" fast path before restoring it. Do **not** mix implicit + explicit waits on the same lookup — their timeouts stack unpredictably.
- `MembersScroller.scrollThroughMembers` — pages the member list via `mobile: scrollGesture`, calling back with the visible `WebElement`s each step; detects end-of-list when the first item's text stops changing across iterations.

### The `device/` package — reading Viber's SQLite over adb
Named `device`, not `db`, because it is the whole path to the phone (adb transport, CSV parsing, device-side queries) — a database of this project's own would live somewhere else entirely. Inside: `AdbSqlite` / `AdbSqliteWriter` (transport, over the shared `AdbShell` process runner) and `SqlExecutor` / `SqlWriter` (the seams that let repositories run without a device), `SqliteCsv` + `Row` (parsing), `ViberDatabase` (the queries), `EmKey` + `ParticipantDecoder` (the write path), `ViberRowMapping` (rows into models — kept apart so the queries file is only about what we ask), `Sql.kt` (`quote()`, the only way a string may enter a statement), and `model/` with `ViberGroup` / `ViberMember` / `ParticipantCard` / the decode report types. Those models are **not** DTOs: `dto/` is the shape of the HTTP response, `device/model/` is what the device's database actually holds, and `dto/ApiMappers.kt` is the only bridge between them.
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
its own `database` yaml section for the path and timeouts. It exposes **two** clients on
purpose — `executor()` reads, `writer()` writes — because those are different device
procedures, not one client with a flag.

### The write path — `EmKey` + `ParticipantDecoder` + `AdbSqliteWriter`

**`encrypted_member_id` is not encrypted.** It is a 42-byte envelope with a fixed layout, and
`EmKey.extract` reads it by offset: `0..2` version `01 00` (checked), `2..10` the 8-byte key
(taken), `10..12` marker `1a 6f` (checked), `12..42` a tail that is never touched. No key, no
IV, no cipher — nothing is decrypted, and **no phone number is recovered from the tail**. The
proof that this is the right 8 bytes is the one card the decoder never writes to: our own
account (`participant_type = 0`) already has `member_id == extract(encrypted_member_id)`.
Viber stores the same bytes in both columns; the envelope just repeats them in the clear.

So the extracted key is almost always **identical to what `member_id` already holds**
(`DecodedParticipant.memberIdChanged` reports when it isn't). The real effect of a run is the
other three columns: `number = NULL`, `participant_type = 1`, `safe_contact = 0`. Those three
live in `NormalisedCard` and are used by **both** the `UPDATE` and the report, so the response
cannot claim one thing while the database holds another. In `DecodedParticipant` and the JSON,
unprefixed fields are the **written** state (`participantType` is always 1) and `previous*` is
what the row held before — an earlier version named the before-value `participantType`, which
read as if we were writing it back.

**A run is idempotent.** A card whose `member_id` already equals the extracted key, with
`participant_type = 1` and `safe_contact = 0`, is skipped as `ALREADY_DECODED` — an
undecoded card carries the envelope itself in `member_id`, a decoded one carries the key.
`number` is deliberately **not** part of that test: Viber puts the number back a few seconds
after it restarts (measured: NULL at ~2 s, restored at ~5 s), so treating "has a number" as
"not decoded" would rewrite the whole table on every call and never converge.

`ParticipantDecoder` reads nine columns from `participants_info` and applies these filters in
order: a blank `encrypted_member_id` is skipped, `participant_type = 0` is skipped unless
`includeSelf` (that card is the login the bot runs on — clearing its number logs the bot out),
an envelope that will not parse goes to `invalid` without failing the run, and a card already
in the target state is skipped. **`limit` cuts
the decoded rows, not the read ones** — it bounds how much gets rewritten, not how deep we
look, so broken envelopes past the limit are still reported.

**adb truncates the command at 4096 bytes.** The command travels as the service string
(`shell:<cmd>`), and past that limit the run dies with `exit 255` and *empty* stdout and
stderr — a failure indistinguishable from silence. Measured on the device: 3.3 KB passes,
4.2 KB does not. That is why the write path sends its script on **stdin** (`sqlite3 "<db>"`
with no SQL argument reads standard input) instead of embedding it in the command like the
read path does: 129 participants are ~21 KB of `UPDATE`s. `AdbSqliteWriterTest` pins this
with a test asserting the command is byte-identical for 1 and 500 statements — the read path
is safe only because its queries are fixed and small, so keep any new query well under 4 KB.

`AdbSqliteWriter` is the mirror of `AdbSqlite`, but writing is not "the same query without
`mode=ro`". A running Viber caches pages and would overwrite the edit, so one `su -c` runs, in
order: `am force-stop` → `stat -c %u:%g` (owner captured **before** anything changes) → `cp` to
`<db>.bak` (no copy, no write) → the whole script as one `BEGIN`/`COMMIT` → `chown` → `am start`.

**Viber always comes back up.** Every exit path after the `force-stop` restarts it: a failed
write still reaches `am start` because the exit code is stashed in `code=$?` first, and the
backup's failure branch is `|| { am start …; exit 1; }` rather than a bare `exit 1` — giving up
silently there would leave the app killed. `restartApp: false` is the only way to skip it, and
it removes the restart from **both** paths. A dry run, and a run with nothing to write, never
open the writer at all, so they do not touch the app. The `chown` is the point of the `stat`: sqlite3 creates `-wal`, `-shm`
and `-journal` as root, and Viber then cannot open its own database. The exit code that
surfaces is **sqlite3's** (`code=$?`), not the last `am`'s. `select total_changes();` closes the
script so the report can say how many rows the database actually changed, rather than trusting
our own statement count. SELinux contexts are **not** restored — this relies on LDPlayer being
permissive.

### Selectors are locale- and resource-id-coupled
Every selector lives in `appium/ViberSelectors.kt` — one file to edit when Viber updates or the
device turns out to be on another locale. Lookups use `AppiumBy.androidUIAutomator` with Viber
resource IDs (`com.viber.voip:id/from`, `:id/recycler_view`, `:id/name`, `:id/conversationInfo`,
`:id/startText`) **and Russian UI text** (`"участник"`, `"Показать всех"`). Text-based selectors
assume the device UI language is **Russian** and break on other locales; resource IDs are tied to
a specific Viber build and can drift between app versions. `ViberSelectorsTest` pins both sets, so
what has to change after a Viber update is visible in one place.

## Device configuration

Everything device-specific lives in the `appium` section of `src/main/resources/application.yaml` and is read once at startup by `plugins/Appium.kt` (`configureAppium`), which pushes an `AppiumSettings` into the `AppiumManager` singleton. **Do not add capability literals back into `AppiumManager`** — add a key to the yaml section and a field to `AppiumSettings` instead.

Every key uses Ktor's `"$ENV_VAR:default"` substitution, so any value is overridable from the environment without touching the file (`APPIUM_UDID`, `APPIUM_SERVER_URL`, `APPIUM_SYSTEM_PORT`, `ADB_PATH`, ...). Defaults target LDPlayer 9 / Android 9 (API 28): `udid` `127.0.0.1:5555`, `platformVersion` 9. `systemPort` is deliberately **left unset** — pinning it means any orphaned Appium session holding that port blocks every subsequent start with `UiAutomator2 Server cannot start because the local port #N is busy`.

Parsing rules that the tests in `AppiumSettingsTest` pin down: a **missing** key falls back to the LDPlayer default, while a key present but **blank** means "do not send this capability" (so an empty env var cannot silently override a sane default). Booleans use `toBooleanStrictOrNull`.

The `database` section adds `writeTimeoutSeconds` (`VIBER_DB_WRITE_TIMEOUT_SECONDS`, default
120 — a write force-stops and restarts Viber, so it takes longer than a read) and
`backupOnWrite` (`VIBER_DB_BACKUP_ON_WRITE`, default true). `backupOnWrite` is parsed with
`toBooleanStrictOrNull`, so only a literal `false` turns the copy off — a blank or garbled env
var leaves the safety net in place.

Running a second LDPlayer instance means overriding both `APPIUM_UDID` (5557, 5559, ...) and `APPIUM_SYSTEM_PORT` (8201, ...) — the UiAutomator2 host port collides otherwise.

`AdbConnector` does not trust `PATH` or `ANDROID_HOME`: Gradle reuses its daemon, so a forked `./gradlew run` inherits the environment of whatever started that daemon, which on this machine has neither. It walks a list of known roots (SDK locations, then the adb LDPlayer ships) before falling back to `PATH`.

## Runtime wiring gotcha
The entry point is `io.ktor.server.netty.EngineMain`, which reads `src/main/resources/application.yaml`. The **effective module list lives in that YAML** (`ktor.application.modules` → `configureAppium`, `configureDatabase`, `configureRouting`, `configureMonitoring`, `configureSerialization`) — note `configureRouting` is `com.viber.routes.RoutingKt`, the rest are `com.viber.plugins.*`, so moving a `configure*` function between packages means editing that list too. `main.kt`'s `Application.module()` duplicates this wiring but is **not referenced by the config**, so editing `main.kt` has no effect on the running server (or on `testApplication`, which also loads the default config) — change `application.yaml` or the `configure*` functions instead.
