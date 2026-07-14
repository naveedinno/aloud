#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

rm -rf "$REPO_DIR/dist"

if [[ "${1:-}" != "--dist-only" ]]; then
  rm -rf "$REPO_DIR/build"
fi
