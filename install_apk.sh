#!/bin/sh
set -e

APK_PATH="${VIBER_APK_PATH:-/apk/viber.apk}"
PACKAGE_NAME="com.viber.voip"

echo "--> Checking if $PACKAGE_NAME is installed..."
if adb shell pm list packages | grep -q "$PACKAGE_NAME"; then
    echo "✅ $PACKAGE_NAME already installed"
else
    echo "--> Installing Viber from $APK_PATH..."
    if [ -f "$APK_PATH" ]; then
        adb install "$APK_PATH"
        echo "✅ Viber installed successfully"
    else
        echo "❌ APK not found at $APK_PATH"
        exit 1
    fi
fi