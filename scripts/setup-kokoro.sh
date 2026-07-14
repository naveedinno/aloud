#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This setup script currently supports macOS only." >&2
  exit 1
fi

APP_SUPPORT="$HOME/Library/Application Support/Kokoro Reader"
VENV_DIR="$APP_SUPPORT/kokoro-venv"
HF_HOME="$APP_SUPPORT/huggingface"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REQUIREMENTS_LOCK="$REPO_DIR/requirements-kokoro-py312.lock.txt"
SETUP_MANIFEST="$APP_SUPPORT/setup-manifest.json"
SETUP_MANIFEST_TEMP="$APP_SUPPORT/.setup-manifest-$$.json"
PIP_VERSION="26.1.2"
MODEL_REPO="hexgrad/Kokoro-82M"
MODEL_REVISION="f3ff3571791e39611d31c381e3a41a3af07b4987"
PYTHON_BIN="${PYTHON_BIN:-}"

# Setup is the one operation that must reach package indexes and the pinned
# Hugging Face revision, even when launched from the normally offline reader.
export HF_HUB_OFFLINE=0
export TRANSFORMERS_OFFLINE=0

if ! command -v brew >/dev/null 2>&1; then
  echo "Homebrew is required to install Python 3.12 and espeak-ng. Install Homebrew first: https://brew.sh" >&2
  exit 1
fi

if [[ -z "$PYTHON_BIN" ]] && command -v python3.12 >/dev/null 2>&1; then
  PYTHON_BIN="$(command -v python3.12)"
fi

if [[ -z "$PYTHON_BIN" ]]; then
  if ! brew list python@3.12 >/dev/null 2>&1; then
    brew install python@3.12
  fi
  PYTHON_BIN="$(brew --prefix python@3.12)/bin/python3.12"
fi

if [[ ! -x "$PYTHON_BIN" ]]; then
  echo "Kokoro Reader requires Python 3.12; no executable was found at: $PYTHON_BIN" >&2
  exit 1
fi

if ! "$PYTHON_BIN" -c 'import sys; raise SystemExit(0 if sys.version_info[:2] == (3, 12) else 1)'; then
  echo "Kokoro Reader requires Python 3.12 exactly. Selected: $($PYTHON_BIN --version 2>&1)" >&2
  exit 1
fi

if ! brew list espeak-ng >/dev/null 2>&1; then
  brew install espeak-ng
fi

if [[ ! -f "$REQUIREMENTS_LOCK" ]]; then
  echo "Missing locked Python requirements: $REQUIREMENTS_LOCK" >&2
  exit 1
fi

mkdir -p "$APP_SUPPORT" "$HF_HOME"
chmod 700 "$APP_SUPPORT" "$HF_HOME"

VENV_BACKUP="$APP_SUPPORT/.kokoro-venv-backup-$$"
SETUP_MANIFEST_BACKUP="$APP_SUPPORT/.setup-manifest-backup-$$.json"
VENV_BACKED_UP=0
VENV_WAS_ABSENT=0
MANIFEST_BACKED_UP=0
MANIFEST_WAS_ABSENT=0
restore_previous_setup() {
  local status=$?
  trap - EXIT
  set +e
  rm -f "$SETUP_MANIFEST_TEMP"
  if [[ "$VENV_BACKED_UP" == "1" ]]; then
    rm -rf "$VENV_DIR"
    mv -f "$VENV_BACKUP" "$VENV_DIR"
  elif [[ "$VENV_WAS_ABSENT" == "1" ]]; then
    rm -rf "$VENV_DIR"
  fi
  if [[ "$MANIFEST_BACKED_UP" == "1" ]]; then
    rm -f "$SETUP_MANIFEST"
    mv -f "$SETUP_MANIFEST_BACKUP" "$SETUP_MANIFEST"
  elif [[ "$MANIFEST_WAS_ABSENT" == "1" ]]; then
    rm -f "$SETUP_MANIFEST"
  fi
  exit "$status"
}

rm -f "$SETUP_MANIFEST_TEMP" "$SETUP_MANIFEST_BACKUP"
rm -rf "$VENV_BACKUP"
trap restore_previous_setup EXIT
if [[ -e "$VENV_DIR" || -L "$VENV_DIR" ]]; then
  mv "$VENV_DIR" "$VENV_BACKUP"
  VENV_BACKED_UP=1
else
  VENV_WAS_ABSENT=1
fi
if [[ -e "$SETUP_MANIFEST" || -L "$SETUP_MANIFEST" ]]; then
  mv "$SETUP_MANIFEST" "$SETUP_MANIFEST_BACKUP"
  MANIFEST_BACKED_UP=1
else
  MANIFEST_WAS_ABSENT=1
fi

"$PYTHON_BIN" -m venv "$VENV_DIR"
"$VENV_DIR/bin/python" -m pip install --disable-pip-version-check "pip==$PIP_VERSION"
"$VENV_DIR/bin/python" -m pip install --disable-pip-version-check --requirement "$REQUIREMENTS_LOCK"
"$VENV_DIR/bin/python" -m pip check

export HF_HOME MODEL_REPO MODEL_REVISION REQUIREMENTS_LOCK SETUP_MANIFEST_TEMP
"$VENV_DIR/bin/python" <<'PY'
import hashlib
import json
import os
import sys
from pathlib import Path

from huggingface_hub import snapshot_download

repo_id = os.environ["MODEL_REPO"]
revision = os.environ["MODEL_REVISION"]
required_files = [
    "config.json",
    "kokoro-v1_0.pth",
    "voices/af_heart.pt",
    "voices/af_bella.pt",
    "voices/af_nicole.pt",
    "voices/af_sarah.pt",
    "voices/am_adam.pt",
    "voices/am_onyx.pt",
    "voices/bf_emma.pt",
    "voices/bm_daniel.pt",
]
snapshot = Path(snapshot_download(repo_id=repo_id, revision=revision, allow_patterns=required_files))
if snapshot.name != revision:
    raise RuntimeError(f"Expected model revision {revision}, downloaded {snapshot.name}")
missing = [relative for relative in required_files if not (snapshot / relative).is_file()]
if missing:
    raise RuntimeError(f"Pinned Kokoro model is incomplete: {', '.join(missing)}")

# Kokoro 0.9.4 requests the repository's default revision. Point that cache ref
# at the verified commit, then production launchers run Hugging Face offline.
refs_dir = snapshot.parent.parent / "refs"
refs_dir.mkdir(parents=True, exist_ok=True)
(refs_dir / "main").write_text(f"{revision}\n", encoding="utf-8")

lock_path = Path(os.environ["REQUIREMENTS_LOCK"])
manifest_path = Path(os.environ["SETUP_MANIFEST_TEMP"])
manifest = {
    "modelRepository": repo_id,
    "modelRevision": revision,
    "pythonVersion": f"{sys.version_info.major}.{sys.version_info.minor}",
    "requiredModelFiles": required_files,
    "requirementsLockSha256": hashlib.sha256(lock_path.read_bytes()).hexdigest(),
    "schemaVersion": 1,
    "status": "complete",
}
manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
manifest_path.chmod(0o600)
print(f"Pinned {repo_id} at {revision}")
PY

if ! mv -f "$SETUP_MANIFEST_TEMP" "$SETUP_MANIFEST"; then
  echo "Could not publish Kokoro Reader's setup manifest: $SETUP_MANIFEST" >&2
  exit 1
fi
trap - EXIT
rm -rf "$VENV_BACKUP"
rm -f "$SETUP_MANIFEST_BACKUP"

echo "Kokoro Reader Python environment is ready:"
echo "$VENV_DIR"
echo "Pinned model cache: $HF_HOME"
echo "Setup manifest: $SETUP_MANIFEST"
