#!/bin/bash
set -euo pipefail

TEST_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "${TEST_DIR}/../.." && pwd)
PROFILE_SCRIPT="${REPO_ROOT}/emulator/setup-device-profile.sh"
FIRST_BOOT="${REPO_ROOT}/emulator/first-boot.sh"
START="${REPO_ROOT}/start.sh"
COMPOSE="${REPO_ROOT}/docker-compose.yaml"
TEST_ROOT=$(mktemp -d)
trap 'rm -rf -- "$TEST_ROOT"' EXIT

assert_contains() {
  grep -Fq -- "$2" "$1" || { echo "Expected $1 to contain: $2" >&2; exit 1; }
}

line_number() {
  grep -nF -- "$2" "$1" | tail -n 1 | cut -d: -f1
}

assert_before() {
  local first second
  first=$(line_number "$1" "$2")
  second=$(line_number "$1" "$3")
  [ -n "$first" ] && [ -n "$second" ] && [ "$first" -lt "$second" ] || {
    echo "Expected '$2' before '$3' in $1" >&2
    exit 1
  }
}

assert_contains "$COMPOSE" './emulator/setup-device-profile.sh:/overrides/setup-device-profile.sh:ro'
assert_contains "$COMPOSE" 'DEVICE_PROFILE=${DEVICE_PROFILE:-samsung-tab-s7}'
assert_contains "$COMPOSE" '/data/local/tmp/.viber-device-profile-ready-v1'
assert_contains "$PROFILE_SCRIPT" 'files/preferences/reg_viber_phone_num_canonized'
assert_before "$FIRST_BOOT" '/overrides/setup-device-profile.sh' 'apply_settings'
assert_before "$START" '.viber-device-profile-ready-v1' '/app/install_apk.sh'

mkdir -p "$TEST_ROOT/bin"
cat > "$TEST_ROOT/bin/adb" <<'MOCK'
#!/bin/bash
set -euo pipefail
printf '%s\n' "$*" >> "$CALLS"
case "${1:-}" in
  wait-for-device|root) exit 0 ;;
  reboot)
    touch "$MOCK_DEVICE/rebooted"
    exit 0
    ;;
  push)
    mkdir -p "$MOCK_DEVICE/module"
    cp "$2" "$MOCK_DEVICE/module/${3##*/}"
    exit 0
    ;;
  pull)
    cp "$MOCK_DEVICE/module/${2##*/}" "$3"
    exit 0
    ;;
  shell)
    shift
    command="$*"
    case "$command" in
      'getprop sys.boot_completed') echo 1 ;;
      'getprop ro.product.model')
        if [ -f "$MOCK_DEVICE/rebooted" ]; then echo SM-T870; else echo 'Android SDK built for x86_64'; fi ;;
      *'[ -f /data/adb/modules/viber-device-profile/profile.env ]'*)
        [ ! -f "$MOCK_DEVICE/module/profile.env" ] || echo yes ;;
      *'[ -f /data/adb/modules/viber-device-profile/system.prop ]'*)
        [ ! -f "$MOCK_DEVICE/module/system.prop" ] || echo yes ;;
      *'[ -f /data/local/tmp/.viber-device-profile-migrated-v1 ]'*)
        [ ! -f "$MOCK_DEVICE/migrated" ] || echo yes ;;
      'pm path com.viber.voip')
        [ ! -f "$MOCK_DEVICE/viber-installed" ] || echo package:/data/app/com.viber.voip/base.apk ;;
      *'VIBER_PROFILE_ACCOUNT_CHECK'*) echo "${MOCK_ACTIVATED:-no}" ;;
      'pm clear com.viber.voip') touch "$MOCK_DEVICE/cleared"; echo Success ;;
      'settings put secure android_id '*) printf '%s\n' "${command##* }" > "$MOCK_DEVICE/android-id" ;;
      *'touch /data/local/tmp/.viber-device-profile-migrated-v1'*) touch "$MOCK_DEVICE/migrated" ;;
      *'touch /data/local/tmp/.viber-device-profile-ready-v1'*) touch "$MOCK_DEVICE/ready" ;;
      *) : ;;
    esac
    ;;
  *) echo "Unexpected adb command: $*" >&2; exit 2 ;;
esac
MOCK
chmod +x "$TEST_ROOT/bin/adb"
export PATH="$TEST_ROOT/bin:$PATH"
export ADB="$TEST_ROOT/bin/adb"
export DEVICE_PROFILE=samsung-tab-s7

run_profile() {
  bash "$PROFILE_SCRIPT" > "$TEST_ROOT/output-$CASE" 2>&1
}

CASE=clean
export MOCK_DEVICE="$TEST_ROOT/clean-device" CALLS="$TEST_ROOT/clean-calls" MOCK_ACTIVATED=no
mkdir -p "$MOCK_DEVICE/module"
: > "$CALLS"
run_profile
grep -Fxq 'ro.product.model=SM-T870' "$MOCK_DEVICE/module/system.prop"
grep -Fxq 'ro.product.manufacturer=samsung' "$MOCK_DEVICE/module/system.prop"
grep -Fxq 'ro.product.device=gts7lwifi' "$MOCK_DEVICE/module/system.prop"
grep -Fxq 'ro.build.characteristics=tablet' "$MOCK_DEVICE/module/system.prop"
grep -Fxq 'ro.build.tags=release-keys' "$MOCK_DEVICE/module/system.prop"
grep -Fxq 'ro.build.type=user' "$MOCK_DEVICE/module/system.prop"
grep -Fxq 'ro.build.fingerprint=samsung/gts7lwifixx/gts7lwifi:11/RP1A.200720.012/T870XXU2BUJ1:user/release-keys' "$MOCK_DEVICE/module/system.prop"
! grep -Eq '^ro\.(hardware|serialno|boot\.|debuggable|secure)' "$MOCK_DEVICE/module/system.prop"
grep -Eq '^ANDROID_ID=[0-9a-f]{16}$' "$MOCK_DEVICE/module/profile.env"
[ -f "$MOCK_DEVICE/ready" ]
! grep -Fq 'pm clear com.viber.voip' "$CALLS"

CASE=stale
export MOCK_DEVICE="$TEST_ROOT/stale-device" CALLS="$TEST_ROOT/stale-calls" MOCK_ACTIVATED=no
mkdir -p "$MOCK_DEVICE/module"
touch "$MOCK_DEVICE/viber-installed"
: > "$CALLS"
run_profile
first_android_id=$(cat "$MOCK_DEVICE/android-id")
grep -Fq 'pm clear com.viber.voip' "$CALLS"
[ -f "$MOCK_DEVICE/migrated" ]
: > "$CALLS"
run_profile
[ "$(cat "$MOCK_DEVICE/android-id")" = "$first_android_id" ]
! grep -Fq 'pm clear com.viber.voip' "$CALLS"
! grep -Fxq 'reboot' "$CALLS"

CASE=activated
export MOCK_DEVICE="$TEST_ROOT/activated-device" CALLS="$TEST_ROOT/activated-calls" MOCK_ACTIVATED=yes
mkdir -p "$MOCK_DEVICE/module"
touch "$MOCK_DEVICE/viber-installed"
: > "$CALLS"
run_profile
! grep -Fq 'pm clear com.viber.voip' "$CALLS"
[ -f "$MOCK_DEVICE/migrated" ]

echo 'Device profile regression checks passed.'
