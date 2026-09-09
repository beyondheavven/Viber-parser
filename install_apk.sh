#!/bin/sh
set -e

PACKAGE_NAME="com.viber.voip"

echo "--> Checking if $PACKAGE_NAME is installed..."
if adb shell pm list packages | grep -q "$PACKAGE_NAME"; then
    echo "✅ $PACKAGE_NAME already installed"
else
    # Ищем любой доступный APK файл в /apk
    APK_PATH="${VIBER_APK_PATH:-}"
    if [ -z "$APK_PATH" ] || [ ! -f "$APK_PATH" ]; then
        APK_PATH=$(ls /apk/*.apk 2>/dev/null | head -n 1)
    fi

    if [ -n "$APK_PATH" ] && [ -f "$APK_PATH" ]; then
        echo "--> Installing Viber from $APK_PATH..."
        adb install "$APK_PATH"
        echo "✅ Viber installed successfully"
    else
        echo "⚠️ No APK file found in /apk directory. Skipping installation."
    fi
fi