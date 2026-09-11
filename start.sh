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

echo "--> Enabling radios (the emulator image leaves airplane mode on)..."
adb shell settings put global airplane_mode_on 0
adb shell am broadcast -a android.intent.action.AIRPLANE_MODE --ez state false >/dev/null 2>&1 || true
adb shell svc data enable || true
adb shell svc wifi enable || true

echo "--> Checking Google Play services..."
/app/fix_gapps.sh

echo "--> Checking/Installing Viber APK..."
/app/install_apk.sh

echo "--> Start Ktor API..."
exec java -Dfile.encoding=UTF-8 -jar /app/app.jar