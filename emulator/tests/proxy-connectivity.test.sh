#!/bin/bash
set -euo pipefail

TEST_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "${TEST_DIR}/../.." && pwd)

line_number() {
  grep -nF -- "$2" "$1" | head -n 1 | cut -d: -f1
}

assert_contains() {
  if ! grep -Fq -- "$2" "$1"; then
    echo "Expected $1 to contain: $2" >&2
    exit 1
  fi
}

assert_not_contains() {
  if grep -Fq -- "$2" "$1"; then
    echo "Expected $1 not to contain: $2" >&2
    exit 1
  fi
}

assert_before() {
  local first second
  first=$(line_number "$1" "$2")
  second=$(line_number "$1" "$3")
  if [ -z "$first" ] || [ -z "$second" ] || [ "$first" -ge "$second" ]; then
    echo "Expected '$2' before '$3' in $1" >&2
    exit 1
  fi
}

ENTRYPOINT="${REPO_ROOT}/emulator/entrypoint.sh"
FIRST_BOOT="${REPO_ROOT}/emulator/first-boot.sh"
START="${REPO_ROOT}/start.sh"

assert_before "$ENTRYPOINT" \
  'iptables -t nat -A REDSOCKS -p tcp --dport 853 -j RETURN' \
  'iptables -t nat -A REDSOCKS -p tcp -j REDIRECT --to-ports 12345'
assert_contains "$ENTRYPOINT" \
  'iptables -t filter -I OUTPUT 1 -p tcp --dport 853 -m owner ! --uid-owner redsocks -j REJECT --reject-with tcp-reset'

for script in "$FIRST_BOOT" "$START"; do
  assert_contains "$script" 'adb shell settings delete global private_dns_specifier'
  assert_not_contains "$script" 'adb shell settings put global captive_portal_mode 0'
  assert_not_contains "$script" 'adb shell settings put global captive_portal_detection_enabled 0'
  assert_before "$script" \
    'adb shell svc wifi disable' \
    'adb shell settings put global private_dns_mode off'
  assert_before "$script" \
    'adb shell settings put global private_dns_mode off' \
    'adb shell svc wifi enable'
done

echo "Proxy connectivity regression checks passed."
