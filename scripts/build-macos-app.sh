#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This app bundle builder only works on macOS." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BUILD_DIR="$REPO_DIR/build"
APP_NAME="Kokoro Reader"
APP_DIR="$BUILD_DIR/$APP_NAME.app"
CONTENTS_DIR="$APP_DIR/Contents"
MACOS_DIR="$CONTENTS_DIR/MacOS"
RESOURCES_DIR="$CONTENTS_DIR/Resources"
APP_RESOURCES_DIR="$RESOURCES_DIR/app"
RESOURCES_NODE_DIR="$RESOURCES_DIR/node/bin"
NODE_SOURCE="${NODE_SOURCE:-$(command -v node)}"

if [[ -z "$NODE_SOURCE" || ! -x "$NODE_SOURCE" ]]; then
  echo "Node.js 20 or newer is required to build Kokoro Reader.app." >&2
  exit 1
fi

if ! "$NODE_SOURCE" -e 'const major = Number(process.versions.node.split(".")[0]); process.exit(major >= 20 ? 0 : 1);'; then
  echo "Node.js 20 or newer is required to build Kokoro Reader.app." >&2
  exit 1
fi

rm -rf "$APP_DIR"
mkdir -p "$MACOS_DIR" "$APP_RESOURCES_DIR/dist" "$APP_RESOURCES_DIR/scripts" "$APP_RESOURCES_DIR/assets" "$RESOURCES_NODE_DIR"

cp -R "$REPO_DIR/dist/." "$APP_RESOURCES_DIR/dist/"
cp -R "$REPO_DIR/assets/." "$APP_RESOURCES_DIR/assets/"
cp "$REPO_DIR/package.json" "$APP_RESOURCES_DIR/package.json"
cp "$REPO_DIR/README.md" "$APP_RESOURCES_DIR/README.md"
cp "$REPO_DIR/scripts/install-macos-service.sh" "$APP_RESOURCES_DIR/scripts/install-macos-service.sh"
cp "$REPO_DIR/scripts/setup-kokoro.sh" "$APP_RESOURCES_DIR/scripts/setup-kokoro.sh"
cp "$NODE_SOURCE" "$RESOURCES_NODE_DIR/node"
chmod +x "$APP_RESOURCES_DIR/scripts/"*.sh
chmod +x "$RESOURCES_NODE_DIR/node"

cat > "$CONTENTS_DIR/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en_US</string>
  <key>CFBundleDisplayName</key>
  <string>Kokoro Reader</string>
  <key>CFBundleExecutable</key>
  <string>Kokoro Reader</string>
  <key>CFBundleIdentifier</key>
  <string>local.kokoro-reader.app</string>
  <key>CFBundleName</key>
  <string>Kokoro Reader</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>0.1.0</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>LSMinimumSystemVersion</key>
  <string>13.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
PLIST

cat > "$MACOS_DIR/Kokoro Reader" <<'LAUNCHER'
#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_RESOURCES_DIR="$APP_DIR/Resources/app"
BUNDLED_NODE="$APP_DIR/Resources/node/bin/node"
PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export PATH

find_node() {
  if [[ -x "$BUNDLED_NODE" ]]; then
    printf '%s\n' "$BUNDLED_NODE"
    return
  fi
  if command -v node >/dev/null 2>&1; then
    command -v node
    return
  fi
  return 1
}

show_dialog() {
  /usr/bin/osascript <<'APPLESCRIPT'
set messageText to "Choose what you want Kokoro Reader to do."
set buttonsList to {"Setup Kokoro", "Install Services", "Open Reader"}
button returned of (display dialog messageText with title "Kokoro Reader" buttons buttonsList default button "Open Reader")
APPLESCRIPT
}

open_terminal_command() {
  local command="$1"
  /usr/bin/osascript <<APPLESCRIPT
tell application "Terminal"
  activate
  do script "$command"
end tell
APPLESCRIPT
}

NODE_BIN="$(find_node || true)"
if [[ -z "$NODE_BIN" ]]; then
  /usr/bin/osascript -e 'display dialog "Kokoro Reader needs Node.js 20 or newer. Install Node.js first, then reopen Kokoro Reader." with title "Kokoro Reader" buttons {"OK"} default button "OK" with icon caution'
  exit 1
fi

cd "$APP_RESOURCES_DIR"

choice="${1:-}"
if [[ -z "$choice" ]]; then
  choice="$(show_dialog)"
fi

case "$choice" in
  "Open Reader"|"open")
    "$NODE_BIN" "$APP_RESOURCES_DIR/dist/cli.js"
    ;;
  "Install Services"|"install")
    "$APP_RESOURCES_DIR/scripts/install-macos-service.sh"
    /usr/bin/osascript -e 'display notification "Services and low-memory daemon installed." with title "Kokoro Reader"'
    ;;
  "Setup Kokoro"|"setup")
    escaped_script="${APP_RESOURCES_DIR//\"/\\\"}/scripts/setup-kokoro.sh"
    open_terminal_command "bash \"$escaped_script\"; echo; echo 'Kokoro Reader setup finished. You can close this window.'"
    ;;
  *)
    exit 0
    ;;
esac
LAUNCHER
chmod +x "$MACOS_DIR/Kokoro Reader"

/usr/bin/plutil -lint "$CONTENTS_DIR/Info.plist" >/dev/null
codesign --force --deep --sign - "$APP_DIR" >/dev/null
ditto -c -k --sequesterRsrc --keepParent "$APP_DIR" "$BUILD_DIR/$APP_NAME.zip"
echo "Built: $APP_DIR"
echo "Packaged: $BUILD_DIR/$APP_NAME.zip"
