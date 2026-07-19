#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This uninstaller only works on macOS." >&2
  exit 1
fi

if [[ -z "${HOME:-}" || "$HOME" != /* || "$HOME" == "/" || ! -d "$HOME" ]]; then
  echo "Refusing to uninstall with an unsafe HOME directory: ${HOME:-<empty>}" >&2
  exit 1
fi

SAFE_HOME="$(cd "$HOME" && pwd -P)"
if [[ -z "$SAFE_HOME" || "$SAFE_HOME" == "/" ]]; then
  echo "Refusing to uninstall with an unsafe canonical HOME directory: $SAFE_HOME" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_SUPPORT="$SAFE_HOME/Library/Application Support/Aloud"
LEGACY_APP_SUPPORT="$SAFE_HOME/Library/Application Support/Kokoro Reader"
SERVICES_DIR="$SAFE_HOME/Library/Services"
LAUNCH_AGENTS_DIR="$SAFE_HOME/Library/LaunchAgents"
TMP_ROOT="${ALOUD_TMP_ROOT:-/tmp}"
DOMAIN="gui/$(id -u)"

WORKFLOWS=(
  "Read Selection Aloud"
  "Stop Aloud"
  "Kokoro Speaker - Heart"
  "Kokoro Speaker - Bella"
  "Kokoro Speaker - Nicole"
  "Kokoro Speaker - Sarah"
  "Kokoro Speaker - Adam"
  "Kokoro Speaker - Onyx"
  "Kokoro Speaker - Emma"
  "Kokoro Speaker - Daniel"
  "Kokoro Style - Slow"
  "Kokoro Style - Normal"
  "Kokoro Style - Fast"
)

remove_launch_agent() {
  local label="$1"
  local plist="$2"
  launchctl bootout "$DOMAIN" "$plist" >/dev/null 2>&1 || true
  launchctl remove "$label" >/dev/null 2>&1 || true
  rm -f "$plist"
}

remove_launch_agent "local.aloud.menubar" "$LAUNCH_AGENTS_DIR/local.aloud.menubar.plist"
remove_launch_agent "local.aloud.daemon" "$LAUNCH_AGENTS_DIR/local.aloud.daemon.plist"
remove_launch_agent "local.kokoro-reader.menubar" "$LAUNCH_AGENTS_DIR/local.kokoro-reader.menubar.plist"
remove_launch_agent "local.kokoro-reader.daemon" "$LAUNCH_AGENTS_DIR/local.kokoro-reader.daemon.plist"

STOP_SCRIPT="$APP_SUPPORT/runtime/current/scripts/stop-owned-daemon.sh"
[[ -x "$STOP_SCRIPT" ]] || STOP_SCRIPT="$SCRIPT_DIR/stop-owned-daemon.sh"
DAEMON_NODE="$APP_SUPPORT/runtime/current/node/bin/node"
DAEMON_CLI="$APP_SUPPORT/runtime/current/dist/cli.js"
if [[ ! -x "$STOP_SCRIPT" ]]; then
  echo "Missing scoped daemon shutdown helper; refusing to remove a possibly running runtime." >&2
  exit 1
fi
"$STOP_SCRIPT" "$DAEMON_NODE" "$DAEMON_CLI"

for service_name in "${WORKFLOWS[@]}"; do
  rm -rf -- "$SERVICES_DIR/$service_name.workflow"
done
rm -rf -- \
  "$SERVICES_DIR/Read Aloud with Kokoro.workflow" \
  "$SERVICES_DIR/Stop Kokoro Reader.workflow"

expected_support="$SAFE_HOME/Library/Application Support/Aloud"
if [[ "$APP_SUPPORT" != "$expected_support" ]]; then
  echo "Refusing to remove an unexpected Application Support path: $APP_SUPPORT" >&2
  exit 1
fi

for owned_path in \
  "$APP_SUPPORT/runtime" \
  "$APP_SUPPORT/menubar" \
  "$APP_SUPPORT/controller" \
  "$APP_SUPPORT/tts-cache" \
  "$APP_SUPPORT/kokoro-venv" \
  "$APP_SUPPORT/huggingface" \
  "$APP_SUPPORT/logs"; do
  rm -rf -- "$owned_path"
done
rm -f "$APP_SUPPORT/preferences.json" "$APP_SUPPORT/setup-manifest.json"
rmdir "$APP_SUPPORT" >/dev/null 2>&1 || true
if [[ "$LEGACY_APP_SUPPORT" == "$SAFE_HOME/Library/Application Support/Kokoro Reader" ]]; then
  rm -rf -- "$LEGACY_APP_SUPPORT"
fi
if [[ "$TMP_ROOT" == /* && "$TMP_ROOT" != "/" ]]; then
  rm -rf -- "$TMP_ROOT/aloud-controller-chrome"
fi

if [[ "${ALOUD_SKIP_REGISTRATION:-0}" != "1" ]]; then
  LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
  if [[ -x "$LSREGISTER" ]]; then
    "$LSREGISTER" -r -domain local -domain system -domain user >/dev/null 2>&1 || true
  fi
  if [[ -x "/System/Library/CoreServices/pbs" ]]; then
    /System/Library/CoreServices/pbs -update en >/dev/null 2>&1 || true
    /System/Library/CoreServices/pbs -flush en >/dev/null 2>&1 || true
  fi
fi

echo "Removed Aloud Services, LaunchAgents, helper, cache, preferences, model, and managed runtime."
