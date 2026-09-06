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

echo "--> Installing Frida..."
curl -L -o /tmp/frida-server https://github.com/frida/frida/releases/download/16.1.4/frida-server-16.1.4-android-x86_64
adb push /tmp/frida-server /data/local/tmp/frida-server
adb shell chmod 755 /data/local/tmp/frida-server

echo "--> Launching Frida-server..."
adb shell "nohup /data/local/tmp/frida-server -l 0.0.0.0:27042 > /dev/null 2>&1 &"

echo "--> Start Ktor API..."
exec java -Dfile.encoding=UTF-8 -jar /app/app.jar