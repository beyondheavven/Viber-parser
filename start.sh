#!/bin/sh
set -e

ADB_HOST="${ADB_HOST:-android-emulator}"
ADB_PORT="${ADB_PORT:-5555}"

echo "--> Connecting to ADB device: ${ADB_HOST}:${ADB_PORT}"
until adb connect "${ADB_HOST}:${ADB_PORT}" 2>&1 | grep -E "connected|already connected"; do
  echo "Waiting for emulator to accept adb connection..."
  sleep 3
done

adb wait-for-device

until [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; do
  sleep 5
done

echo "The emulator has been loaded."
adb root

# Radios and screen are primarily handled by emulator/first-boot.sh (mounted
# over the image's script, which would otherwise re-enable airplane mode and a
# 15s screen-off timeout on every boot). Re-asserted here as a fallback for a
# stack that runs the stock image.
echo "--> Enabling radios..."
adb shell settings put global airplane_mode_on 0
adb shell am broadcast -a android.intent.action.AIRPLANE_MODE --ez state false >/dev/null 2>&1 || true
adb shell svc data enable || true
adb shell svc wifi enable || true
adb shell settings put global private_dns_mode off >/dev/null 2>&1 || true
adb shell settings put global captive_portal_mode 0 >/dev/null 2>&1 || true
adb shell settings put global captive_portal_detection_enabled 0 >/dev/null 2>&1 || true

echo "--> Keeping the screen on..."
# A sleeping display swallows every blind `input tap` / `input text` the bot
# sends over adb, and Appium only wakes it when a session starts.
adb shell settings put system screen_off_timeout 2147483647
adb shell settings put global stay_on_while_plugged_in 7
adb shell svc power stayon true || true
adb shell input keyevent KEYCODE_WAKEUP || true

echo "--> Checking Google Play services..."
/app/fix_gapps.sh

echo "--> Checking/Installing Viber APK..."
/app/install_apk.sh

echo "--> Start Ktor API..."
exec java -Dfile.encoding=UTF-8 -jar /app/app.jar
