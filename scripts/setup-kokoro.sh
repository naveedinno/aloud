#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This setup script currently supports macOS only." >&2
  exit 1
fi

APP_SUPPORT="$HOME/Library/Application Support/Kokoro Reader"
VENV_DIR="$APP_SUPPORT/kokoro-venv"
PYTHON_BIN="${PYTHON_BIN:-}"

if [[ -z "$PYTHON_BIN" ]]; then
  if command -v python3.12 >/dev/null 2>&1; then
    PYTHON_BIN="$(command -v python3.12)"
  else
    PYTHON_BIN="$(command -v python3)"
  fi
fi

if ! command -v brew >/dev/null 2>&1; then
  echo "Homebrew is required to install espeak-ng. Install Homebrew first: https://brew.sh" >&2
  exit 1
fi

if ! brew list espeak-ng >/dev/null 2>&1; then
  brew install espeak-ng
fi

mkdir -p "$APP_SUPPORT"
"$PYTHON_BIN" -m venv "$VENV_DIR"
"$VENV_DIR/bin/python" -m pip install --upgrade pip
"$VENV_DIR/bin/python" -m pip install "kokoro>=0.9.4" soundfile torch

echo "Kokoro Reader Python environment is ready:"
echo "$VENV_DIR"
