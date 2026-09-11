#!/bin/sh
set -e

# Makes the emulator image's Google Play services actually load.
#
# With GAPPS_SETUP=true the emulator image installs OpenGApps as a Magisk
# module, but it does so with `adb push` instead of Magisk's own installer, so
# the files keep the `shell_data_file` SELinux label they were pushed with.
# Magisk bind-mounts them into /system with that label, SELinux (Enforcing)
# stops system_server from reading them, and every APK is dropped at boot:
#
#   W PackageManager: Failed to parse /system/priv-app/PrebuiltGmsCore: ...
#
# The result is a device with the GAPPS files present but no Google packages
# installed — which Viber's activation refuses. Relabelling the module to
# `system_file` and letting PackageManager rescan fixes it.
#
# Idempotent: does nothing once Play services are registered.

MODULE_DIR="/data/adb/modules/gapps"
GMS_PACKAGE="com.google.android.gms"

if adb shell pm list packages 2>/dev/null | grep -q "$GMS_PACKAGE"; then
    echo "✅ Google Play services already registered"
    exit 0
fi

if ! adb shell "test -d $MODULE_DIR/system" 2>/dev/null; then
    echo "⚠️ No GAPPS Magisk module at $MODULE_DIR — set GAPPS_SETUP=true and recreate the emulator."
    exit 0
fi

echo "--> GAPPS module present but no Google packages; relabelling it for SELinux..."
adb root >/dev/null 2>&1 || true
adb wait-for-device

adb shell "
  find $MODULE_DIR/system -type d -exec chmod 755 {} + 2>/dev/null
  find $MODULE_DIR/system -type f -exec chmod 644 {} + 2>/dev/null
  chcon -R u:object_r:system_file:s0 $MODULE_DIR/system
  rm -rf /data/system/package_cache/* 2>/dev/null
"

echo "--> Rebooting so PackageManager rescans /system..."
adb reboot
adb wait-for-device
until [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; do
    sleep 5
done

if adb shell pm list packages 2>/dev/null | grep -q "$GMS_PACKAGE"; then
    echo "✅ Google Play services registered"
else
    echo "⚠️ Google Play services still missing — check 'adb logcat | grep PackageManager'."
fi
