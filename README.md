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

## Reading the Viber database

Besides driving the UI, the app can read Viber's own SQLite database straight off the
device — no root shell on the host, no copying the file. A query is shipped to the device
over `adb shell -T`, decoded there and handed to Android's built-in `sqlite3`, which
returns CSV:

```
adb -s <udid> shell -T "su -c 'echo <base64 sql> | base64 -d | sqlite3 -csv -header \"file:<db>?mode=ro\"'"
```

Three details make this reliable:

- **`shell -T`, not `exec-out`** — only `shell` (over `shell_v2`) carries the exit code back
  and keeps `stderr` separate, so a failed query is distinguishable from an empty result.
- **base64 transport** — the command line only ever contains `[A-Za-z0-9+/=]`, so quotes,
  newlines and Cyrillic inside a query cannot break the device shell or Windows argument
  quoting.
- **`file:...?mode=ro`** — Viber is running while we read, so the database is opened
  read-only. (`sqlite3 -readonly` does not exist in the 3.22 build shipped with Android 9.)

Requires a rooted device (LDPlayer is rooted out of the box) — the databases live under
`/data/data/com.viber.voip/databases/`, reachable only through `su`.

### Configuration

| Variable | Default | Meaning |
|---|---|---|
| `VIBER_DB_PATH` | `/data/data/com.viber.voip/databases/viber_messages` | Database to read; `viber_data` holds the phone book |
| `VIBER_DB_QUERY_TIMEOUT_SECONDS` | `60` | How long a single query may take |

The device itself (`APPIUM_UDID`, `ADB_PATH`) is taken from the `appium` section — it is the
same phone, so its address is not duplicated.

### Using it

```kotlin
val db = DeviceDatabase.viber

val groups = db.groups()                                  // group conversations + member counts
val members = db.members(groups.first().conversationId)    // active members, joined with their cards
val byName = db.membersOfGroup("Название группы")          // same, looked up by group name
val leavers = db.members(id, includeInactive = true)       // including people who left

member.displayedName    // alias in the group -> display_name -> contact -> Viber name -> number
```

### `GET /api/groups`

Lists the group conversations present in the database on the device:

```json
{
  "count": 3,
  "groups": [
    { "conversationId": 20, "groupId": 5569560781658637023, "name": "Название группы", "conversationType": 5, "memberCount": 53 }
  ]
}
```

`memberCount` counts members who are still in the group. Unlike `/api/start` and
`/api/scroll-members`, this endpoint answers synchronously — a query is one short adb run,
not a UI automation session. It needs no Appium session at all, only a reachable device.
If the device (or its database) cannot be read, it answers **503** with the underlying
error instead of an empty list.

### `GET /api/groups/{id}/members`

Members of one group, joined with their cards from `participants_info`:

```json
{
  "conversationId": 20,
  "groupName": "Название группы",
  "count": 53,
  "members": [
    {
      "participantId": 83, "memberId": "djqZ...", "encryptedMemberId": "em:AQA...", "number": "+380671234567",
      "displayedName": "Alina", "displayName": "Alina", "contactName": null,
      "viberName": "Alina", "aliasName": null, "active": true, "groupRole": 3
    }
  ]
}
```

Duplicates are collapsed before the list is built. Viber keeps one person as **two**
cards in `participants_info`: `participant_type = 1` with the real phone number, and
`participant_type = 2` where `number` holds an encrypted value instead. Both are wired
into `participants`, so an unfiltered list double-counts — a live group shows 53 rows for
38 people. The join key is `encrypted_member_id` (identical on both cards, and filled in
where `member_id` may itself be the encrypted value); the card kept is the one with the
real phone number. `memberCount` in `/api/groups` counts people the same way, so the two
endpoints agree.

`displayedName` is what Viber itself shows: the name set inside the group, then the
prepared `display_name`, then the contact card, then the number. `groupRole` is the raw
Viber value (1, 2 and 3 all occur — owner, admin, member). Add `?includeInactive=true`
to keep people who have left the group.

Answers **404** for a conversation id that is not a group on this device (so an empty
result is never confused with a missing group), **400** for a non-numeric id and **503**
when the device cannot be read.

For anything without a typed query yet, `DeviceDatabase.executor().query("select ...")`
returns rows addressed by column name, with NULL kept distinct from an empty string.
Values are interpolated into SQL as text (the device `sqlite3` is a CLI, it has no
placeholders), so string arguments must go through the repository, which quotes them.
