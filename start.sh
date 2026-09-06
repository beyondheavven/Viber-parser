#!/bin/sh
set -e

echo "--> Connecting to ADB device: ${ADB_HOST}:${ADB_PORT}"
until adb connect "${ADB_HOST}:${ADB_PORT}" | grep -q "connected"; do
  echo "Waiting for emulator to accept adb connection..."
  sleep 3
done

adb wait-for-device

until [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; do
  sleep 5
done

echo "The emulator has been loaded."
adb root

echo "--> Checking/Installing Viber APK..."
/app/install_apk.sh

echo "--> Start Ktor API..."
exec java -Dfile.encoding=UTF-8 -jar /app/app.jar