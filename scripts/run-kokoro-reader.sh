#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
APP_SUPPORT="$HOME/Library/Application Support/Kokoro Reader"

export HF_HOME="${HF_HOME:-$APP_SUPPORT/huggingface}"
export HF_HUB_OFFLINE="${HF_HUB_OFFLINE:-1}"

exec node "$REPO_DIR/dist/cli.js" "$@"
