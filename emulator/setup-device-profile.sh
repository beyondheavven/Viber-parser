#!/bin/bash
set -euo pipefail

ADB="${ADB:-adb}"
DEVICE_PROFILE="${DEVICE_PROFILE:-samsung-tab-s7}"
MOD_DIR=/data/adb/modules/viber-device-profile
READY_MARKER=/data/local/tmp/.viber-device-profile-ready-v1
MIGRATION_MARKER=/data/local/tmp/.viber-device-profile-migrated-v1
VIBER_PACKAGE=com.viber.voip
MODEL=SM-T870
BRAND=samsung
MANUFACTURER=samsung
PRODUCT=gts7lwifixx
DEVICE=gts7lwifi
BUILD_ID=RP1A.200720.012
INCREMENTAL=T870XXU2BUJ1
FINGERPRINT=samsung/gts7lwifixx/gts7lwifi:11/RP1A.200720.012/T870XXU2BUJ1:user/release-keys
DISPLAY_ID=RP1A.200720.012.T870XXU2BUJ1
DESCRIPTION="gts7lwifixx-user 11 RP1A.200720.012 T870XXU2BUJ1 release-keys"

wait_for_android() {
  "$ADB" wait-for-device
  until [ "$("$ADB" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ]; do
    sleep 2
  done
  "$ADB" root >/dev/null
  "$ADB" wait-for-device
}

remote_file_exists() {
  [ "$("$ADB" shell "[ -f $1 ] && echo yes" 2>/dev/null | tr -d '\r')" = yes ]
}

random_android_id() {
  head -c 8 /dev/urandom | od -An -tx1 | tr -d ' \n'
}

account_data_state() {
  "$ADB" shell '
    # VIBER_PROFILE_ACCOUNT_CHECK
    phone_file=/data/data/com.viber.voip/files/preferences/reg_viber_phone_num_canonized
    if [ -f "$phone_file" ]; then
      phone=$(tr -d " +()-\r\n" < "$phone_file" 2>/dev/null)
      case "$phone" in
        *[!0-9]*|?????*) ;;
        *) echo yes; exit 0 ;;
      esac
      if printf "%s" "$phone" | grep -Eq "^[0-9]{6,18}$"; then
        echo yes
        exit 0
      fi
    fi
    SQLITE=$(command -v sqlite3 2>/dev/null) || { echo unknown; exit 0; }
    total=0
    checked=0
    query_count() {
      db="$1"
      sql="$2"
      [ -f "$db" ] || return 0
      value=$($SQLITE "$db" "$sql" 2>/dev/null) || { echo unknown; exit 3; }
      case "$value" in
        ""|*[!0-9]*) echo unknown; exit 3 ;;
      esac
      total=$((total + value))
      checked=$((checked + 1))
    }
    query_count /data/data/com.viber.voip/databases/viber_messages \
      "SELECT (SELECT count(*) FROM participants) + (SELECT count(*) FROM conversations);" || exit 0
    query_count /data/data/com.viber.voip/databases/viber_data \
      "SELECT (SELECT count(*) FROM vibernumbers) + (SELECT count(*) FROM sync_data);" || exit 0
    [ "$checked" -gt 0 ] || { echo unknown; exit 0; }
    if [ "$total" -gt 0 ]; then echo yes; else echo no; fi
  ' | tr -d '\r'
}

migrate_generic_viber_data_once() {
  remote_file_exists "$MIGRATION_MARKER" && return

  local current_model package_path state
  current_model=$("$ADB" shell getprop ro.product.model 2>/dev/null | tr -d '\r')
  case "$current_model" in
    "Android SDK built for x86_64"|"Android SDK built for x86"|unknown|generic*) ;;
    *)
      "$ADB" shell "touch $MIGRATION_MARKER"
      return
      ;;
  esac

  package_path=$("$ADB" shell "pm path $VIBER_PACKAGE" 2>/dev/null | tr -d '\r')
  if [ -n "$package_path" ]; then
    state=$(account_data_state)
    if [ "$state" = no ]; then
      echo "[device-profile] Clearing unactivated Viber data created under the generic emulator identity."
      "$ADB" shell "pm clear $VIBER_PACKAGE" >/dev/null
    else
      echo "[device-profile] Preserving existing Viber data (activation state: $state)."
    fi
  fi
  "$ADB" shell "touch $MIGRATION_MARKER"
}

wait_for_android
"$ADB" shell "rm -f $READY_MARKER"

if [ "$DEVICE_PROFILE" = none ]; then
  if "$ADB" shell "test -d $MOD_DIR" >/dev/null 2>&1; then
    "$ADB" shell "rm -rf $MOD_DIR"
    "$ADB" reboot
    wait_for_android
  fi
  "$ADB" shell "touch $READY_MARKER"
  echo "[device-profile] Device profile disabled."
  exit 0
fi

if [ "$DEVICE_PROFILE" != samsung-tab-s7 ]; then
  echo "[device-profile] Unsupported profile: $DEVICE_PROFILE" >&2
  exit 2
fi

migrate_generic_viber_data_once

PROFILE_TEMP=$(mktemp -d)
trap 'rm -rf -- "$PROFILE_TEMP"' EXIT
PROFILE_ENV="$PROFILE_TEMP/profile.env"
SYSTEM_PROP="$PROFILE_TEMP/system.prop"
PROFILE_CHANGED=1

if remote_file_exists "$MOD_DIR/profile.env"; then
  "$ADB" pull "$MOD_DIR/profile.env" "$PROFILE_ENV" >/dev/null
  ANDROID_ID=$(sed -n 's/^ANDROID_ID=//p' "$PROFILE_ENV")
  if ! [[ "$ANDROID_ID" =~ ^[0-9a-f]{16}$ ]]; then
    echo "[device-profile] Stored Android ID is invalid; refusing to replace a stable identity." >&2
    exit 1
  fi
else
  ANDROID_ID=$(random_android_id)
  printf 'ANDROID_ID=%s\n' "$ANDROID_ID" > "$PROFILE_ENV"
fi

{
  echo "# Samsung Galaxy Tab S7 Wi-Fi ($MODEL)"
  for part in '' system. vendor. odm. product. system_ext.; do
    echo "ro.product.${part}model=$MODEL"
    echo "ro.product.${part}brand=$BRAND"
    echo "ro.product.${part}manufacturer=$MANUFACTURER"
    echo "ro.product.${part}name=$PRODUCT"
    echo "ro.product.${part}device=$DEVICE"
  done
  for key in ro.build.fingerprint ro.system.build.fingerprint ro.vendor.build.fingerprint ro.odm.build.fingerprint ro.product.build.fingerprint ro.system_ext.build.fingerprint ro.bootimage.build.fingerprint; do
    echo "$key=$FINGERPRINT"
  done
  echo "ro.build.id=$BUILD_ID"
  echo "ro.build.display.id=$DISPLAY_ID"
  echo "ro.build.version.incremental=$INCREMENTAL"
  echo "ro.build.description=$DESCRIPTION"
  echo 'ro.build.tags=release-keys'
  echo 'ro.build.type=user'
  echo 'ro.build.characteristics=tablet'
} > "$SYSTEM_PROP"

if remote_file_exists "$MOD_DIR/system.prop"; then
  "$ADB" pull "$MOD_DIR/system.prop" "$PROFILE_TEMP/previous.prop" >/dev/null
  if cmp -s "$SYSTEM_PROP" "$PROFILE_TEMP/previous.prop"; then
    PROFILE_CHANGED=0
  fi
fi

cat > "$PROFILE_TEMP/module.prop" <<'EOF'
id=viber-device-profile
name=Viber physical tablet profile
version=1.0
versionCode=1
author=Viber-parser
description=Stable Samsung Galaxy Tab S7 identity for Viber registration
EOF

"$ADB" shell "mkdir -p $MOD_DIR"
for file in system.prop module.prop profile.env; do
  "$ADB" push "$PROFILE_TEMP/$file" "$MOD_DIR/$file" >/dev/null
done
"$ADB" shell "chmod 755 $MOD_DIR && chmod 644 $MOD_DIR/system.prop $MOD_DIR/module.prop $MOD_DIR/profile.env && rm -f $MOD_DIR/disable $MOD_DIR/remove"
"$ADB" shell "settings put secure android_id $ANDROID_ID"

CURRENT_MODEL=$("$ADB" shell getprop ro.product.model 2>/dev/null | tr -d '\r')
if [ "$PROFILE_CHANGED" = 1 ] || [ "$CURRENT_MODEL" != "$MODEL" ]; then
  "$ADB" reboot
  wait_for_android
fi

CURRENT_MODEL=$("$ADB" shell getprop ro.product.model 2>/dev/null | tr -d '\r')
if [ "$CURRENT_MODEL" != "$MODEL" ]; then
  echo "[device-profile] Profile did not apply; expected $MODEL, got $CURRENT_MODEL" >&2
  exit 1
fi

"$ADB" shell "wm density 240" >/dev/null 2>&1 || true

# Install persistent Magisk autorun boot service
"$ADB" shell "mkdir -p /data/adb/service.d"
"$ADB" shell "cat << 'AUTORUN_EOF' > /data/adb/service.d/99-viber-autorun.sh
#!/system/bin/sh
while [ \"\$(getprop sys.boot_completed)\" != \"1\" ]; do
  sleep 2
done
while ! pm path com.viber.voip >/dev/null 2>&1; do
  sleep 2
done
sleep 3
if ! pidof com.viber.voip >/dev/null 2>&1; then
  am start -n com.viber.voip/com.viber.voip.WelcomeActivity >/dev/null 2>&1 || \
    monkey -p com.viber.voip -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
fi
AUTORUN_EOF
chmod 755 /data/adb/service.d/99-viber-autorun.sh"
"$ADB" shell "touch $READY_MARKER"
echo "[device-profile] Physical tablet profile is ready: $MODEL"
