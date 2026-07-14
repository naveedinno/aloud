#!/usr/bin/env bash
set -euo pipefail

NODE_BIN="${1:-}"
CLI_PATH="${2:-}"
PORT="${KOKORO_READER_DAEMON_PORT:-17878}"
LSOF_BIN="${KOKORO_READER_LSOF_BIN:-/usr/sbin/lsof}"
PS_BIN="${KOKORO_READER_PS_BIN:-/bin/ps}"

if [[ ! "$PORT" =~ ^[0-9]+$ || "$PORT" -lt 1024 || "$PORT" -gt 65535 ]]; then
  echo "Invalid Kokoro Reader daemon port: $PORT" >&2
  exit 1
fi

listener_pids() {
  "$LSOF_BIN" -nP -a -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null || true
}

wait_until_free() {
  local attempt
  for ((attempt = 0; attempt < 30; attempt++)); do
    [[ -z "$(listener_pids)" ]] && return 0
    sleep 0.1
  done
  return 1
}

is_owned_command() {
  local command="$1"
  case "$command" in
    node\ *|*/node\ *) ;;
    *) return 1 ;;
  esac
  case "$command" in
    *"/kokoro-reader/dist/cli.js daemon") return 0 ;;
    *"/Application Support/Kokoro Reader/runtime/"*"/dist/cli.js daemon") return 0 ;;
    *"/Kokoro Reader.app/Contents/Resources/app/dist/cli.js daemon") return 0 ;;
    *) return 1 ;;
  esac
}

pids="$(listener_pids)"
[[ -z "$pids" ]] && exit 0
if [[ "$(printf '%s\n' "$pids" | awk 'NF {count++} END {print count + 0}')" -ne 1 ]]; then
  echo "Refusing to stop port $PORT because it has multiple listeners." >&2
  exit 1
fi

pid="$(printf '%s' "$pids" | tr -d '[:space:]')"
command="$($PS_BIN -ww -p "$pid" -o command= 2>/dev/null || true)"
if ! is_owned_command "$command"; then
  echo "Refusing to stop unverified listener $pid on port $PORT: $command" >&2
  exit 1
fi

if [[ -x "$NODE_BIN" && -f "$CLI_PATH" ]]; then
  "$NODE_BIN" "$CLI_PATH" shutdown-daemon >/dev/null 2>&1 || true
  wait_until_free && exit 0
  remaining="$(listener_pids)"
  remaining="$(printf '%s' "$remaining" | tr -d '[:space:]')"
  command="$($PS_BIN -ww -p "$pid" -o command= 2>/dev/null || true)"
  if [[ "$remaining" != "$pid" ]] || ! is_owned_command "$command"; then
    echo "Listener ownership changed after graceful shutdown; refusing to send a signal." >&2
    exit 1
  fi
fi

kill -TERM "$pid"
wait_until_free && exit 0

remaining="$(listener_pids)"
remaining="$(printf '%s' "$remaining" | tr -d '[:space:]')"
command="$($PS_BIN -ww -p "$pid" -o command= 2>/dev/null || true)"
if [[ "$remaining" != "$pid" ]] || ! is_owned_command "$command"; then
  echo "Listener ownership changed while stopping port $PORT; refusing to send SIGKILL." >&2
  exit 1
fi

kill -KILL "$pid"
if ! wait_until_free; then
  echo "Verified Kokoro Reader daemon $pid did not release port $PORT." >&2
  exit 1
fi
