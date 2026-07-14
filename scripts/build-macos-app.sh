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
NATIVE_BUILD_HOME="$BUILD_DIR/native-build-home"
NODE_SOURCE="${NODE_SOURCE:-$(command -v node || true)}"
NODE_LICENSE_SOURCE="${NODE_LICENSE_FILE:-}"
SIGN_IDENTITY="${MACOS_SIGN_IDENTITY:--}"
NOTARY_PROFILE="${MACOS_NOTARY_PROFILE:-}"
NODE_ENTITLEMENTS="$REPO_DIR/packaging/macos/node.entitlements"

if [[ -z "$NODE_SOURCE" || ! -x "$NODE_SOURCE" ]]; then
  echo "Node.js 20 or newer is required to build Kokoro Reader.app." >&2
  exit 1
fi

if ! "$NODE_SOURCE" -e 'const major = Number(process.versions.node.split(".")[0]); process.exit(major >= 20 ? 0 : 1);'; then
  echo "Node.js 20 or newer is required to build Kokoro Reader.app." >&2
  exit 1
fi

NODE_VERSION="$("$NODE_SOURCE" -p 'process.versions.node')"
if [[ -z "$NODE_LICENSE_SOURCE" ]]; then
  NODE_PREFIX="$(cd "$(dirname "$NODE_SOURCE")/.." && pwd)"
  for candidate in "$NODE_PREFIX/LICENSE" "$NODE_PREFIX/LICENSE.txt" "$NODE_PREFIX/share/doc/node/LICENSE"; do
    if [[ -f "$candidate" ]]; then
      NODE_LICENSE_SOURCE="$candidate"
      break
    fi
  done
fi
if [[ -z "$NODE_LICENSE_SOURCE" || ! -f "$NODE_LICENSE_SOURCE" ]]; then
  echo "The bundled Node.js runtime must include its complete upstream LICENSE and third-party notices." >&2
  echo "Set NODE_LICENSE_FILE to the LICENSE file shipped with Node.js $NODE_VERSION." >&2
  exit 1
fi
if [[ -n "$NOTARY_PROFILE" && "$SIGN_IDENTITY" == "-" ]]; then
  echo "MACOS_NOTARY_PROFILE requires a Developer ID identity in MACOS_SIGN_IDENTITY." >&2
  exit 1
fi

APP_VERSION="$("$NODE_SOURCE" -p 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).version' "$REPO_DIR/package.json")"
if [[ ! "$APP_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "package.json must contain a numeric x.y.z version; found: $APP_VERSION" >&2
  exit 1
fi

case "$(uname -m)" in
  arm64) RUNTIME_ARCH="arm64" ;;
  x86_64) RUNTIME_ARCH="x86_64" ;;
  *)
    echo "Unsupported macOS build architecture: $(uname -m)" >&2
    exit 1
    ;;
esac

NODE_ARCHS="$(lipo -archs "$NODE_SOURCE" 2>/dev/null || true)"
if [[ " $NODE_ARCHS " != *" $RUNTIME_ARCH "* ]]; then
  echo "Node runtime architectures [$NODE_ARCHS] do not include build target $RUNTIME_ARCH." >&2
  exit 1
fi

validate_system_dylibs() {
  local binary="$1"
  local links dependency unexpected=""
  if ! links="$(otool -L "$binary")"; then
    echo "Could not inspect dynamic-library dependencies for: $binary" >&2
    return 1
  fi
  while IFS= read -r dependency; do
    case "$dependency" in
      /System/Library/*|/usr/lib/*) ;;
      '') ;;
      *) unexpected="${unexpected}${unexpected:+, }$dependency" ;;
    esac
  done <<< "$(printf '%s\n' "$links" | awk '/^[[:space:]]/{print $1}')"
  if [[ -n "$unexpected" ]]; then
    echo "Refusing to package a non-portable runtime. $binary depends on: $unexpected" >&2
    echo "Use a self-contained Node distribution whose dylibs come only from /System/Library or /usr/lib." >&2
    return 1
  fi
}

validate_system_dylibs "$NODE_SOURCE"

validate_macos_target() {
  local binary="$1"
  local maximum="$2"
  local versions version
  versions="$(otool -l "$binary" | awk '$1 == "minos" {print $2}')"
  if [[ -z "$versions" ]]; then
    echo "Could not determine the minimum macOS version for: $binary" >&2
    return 1
  fi
  while IFS= read -r version; do
    if ! awk -v version="$version" -v maximum="$maximum" 'BEGIN {
      split(version, actual, "."); split(maximum, allowed, ".");
      for (i = 1; i <= 3; i++) {
        a = actual[i] + 0; b = allowed[i] + 0;
        if (a < b) exit 0;
        if (a > b) exit 1;
      }
      exit 0;
    }'; then
      echo "$binary requires macOS $version, newer than the declared macOS $maximum minimum." >&2
      return 1
    fi
  done <<< "$versions"
}

validate_macos_target "$NODE_SOURCE" "13.0"

ARTIFACT_STEM="$APP_NAME-$APP_VERSION-macos-$RUNTIME_ARCH"
ZIP_PATH="$BUILD_DIR/$ARTIFACT_STEM.zip"

mkdir -p "$BUILD_DIR"
rm -rf "$APP_DIR" "$NATIVE_BUILD_HOME" "$BUILD_DIR/dmg-staging"
find "$BUILD_DIR" -maxdepth 1 -type f \( \
  -name "$APP_NAME-*-macos-*.zip" -o \
  -name "$APP_NAME-*-macos-*.dmg" -o \
  -name "$APP_NAME.zip" -o \
  -name "$APP_NAME.dmg" \
\) -delete
mkdir -p "$MACOS_DIR" "$APP_RESOURCES_DIR/dist" "$APP_RESOURCES_DIR/scripts" "$APP_RESOURCES_DIR/assets" "$APP_RESOURCES_DIR/native" "$RESOURCES_NODE_DIR"

/usr/bin/ditto "$REPO_DIR/dist" "$APP_RESOURCES_DIR/dist"
/usr/bin/ditto "$REPO_DIR/assets" "$APP_RESOURCES_DIR/assets"
cp "$REPO_DIR/package.json" "$APP_RESOURCES_DIR/package.json"
cp "$REPO_DIR/README.md" "$APP_RESOURCES_DIR/README.md"
cp "$REPO_DIR/requirements-kokoro-py312.lock.txt" "$APP_RESOURCES_DIR/requirements-kokoro-py312.lock.txt"
for payload_script in install-macos-service.sh uninstall-macos-service.sh setup-kokoro.sh run-kokoro-reader.sh stop-owned-daemon.sh; do
  cp "$REPO_DIR/scripts/$payload_script" "$APP_RESOURCES_DIR/scripts/$payload_script"
done
cp "$NODE_SOURCE" "$RESOURCES_NODE_DIR/node"
cp "$NODE_LICENSE_SOURCE" "$RESOURCES_DIR/node/LICENSE"
printf '%s\n' "$NODE_VERSION" > "$RESOURCES_DIR/node/VERSION"
chmod 755 "$APP_RESOURCES_DIR/scripts/"*.sh "$RESOURCES_NODE_DIR/node"

HOME="$NATIVE_BUILD_HOME" "$NODE_SOURCE" "$REPO_DIR/dist/cli.js" prepare-menubar
NATIVE_HELPER="$NATIVE_BUILD_HOME/Library/Application Support/Kokoro Reader/menubar/KokoroReaderMenuBar"
NATIVE_SOURCE="$NATIVE_BUILD_HOME/Library/Application Support/Kokoro Reader/menubar/KokoroReaderMenuBar.swift"
if [[ ! -x "$NATIVE_HELPER" || ! -f "$NATIVE_SOURCE" ]]; then
  echo "Failed to compile the native menu bar helper. Install the Xcode Command Line Tools and retry." >&2
  exit 1
fi
HOME="$NATIVE_BUILD_HOME" /usr/bin/swiftc -target "$RUNTIME_ARCH-apple-macosx13.0" "$NATIVE_SOURCE" -o "$NATIVE_HELPER"
validate_macos_target "$NATIVE_HELPER" "13.0"
HELPER_ARCHS="$(lipo -archs "$NATIVE_HELPER" 2>/dev/null || true)"
if [[ " $HELPER_ARCHS " != *" $RUNTIME_ARCH "* ]]; then
  echo "Menu bar helper architectures [$HELPER_ARCHS] do not include $RUNTIME_ARCH." >&2
  exit 1
fi
cp "$NATIVE_HELPER" "$APP_RESOURCES_DIR/native/KokoroReaderMenuBar"
chmod 755 "$APP_RESOURCES_DIR/native/KokoroReaderMenuBar"
rm -rf "$NATIVE_BUILD_HOME"

printf '%s\n' "$RUNTIME_ARCH" > "$RESOURCES_DIR/runtime-architecture.txt"
printf '%s\n' "$APP_VERSION" > "$RESOURCES_DIR/version.txt"

cat > "$CONTENTS_DIR/Info.plist" <<PLIST
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
  <string>$APP_VERSION</string>
  <key>CFBundleVersion</key>
  <string>$APP_VERSION</string>
  <key>LSArchitecturePriority</key>
  <array>
    <string>$RUNTIME_ARCH</string>
  </array>
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
SOURCE_INSTALLER="$APP_RESOURCES_DIR/scripts/install-macos-service.sh"
APP_SUPPORT="$HOME/Library/Application Support/Kokoro Reader"
STABLE_RUNTIME="$APP_SUPPORT/runtime/current"
PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export PATH

show_dialog() {
  /usr/bin/osascript <<'APPLESCRIPT'
set messageText to "Choose what you want Kokoro Reader to do."
set buttonsList to {"Setup Kokoro", "Install Services", "Open Reader"}
button returned of (display dialog messageText with title "Kokoro Reader" buttons buttonsList default button "Open Reader")
APPLESCRIPT
}

show_error() {
  KOKORO_READER_ERROR="$1" /usr/bin/osascript <<'APPLESCRIPT'
set errorText to system attribute "KOKORO_READER_ERROR"
display dialog errorText with title "Kokoro Reader could not finish" buttons {"OK"} default button "OK" with icon caution
APPLESCRIPT
}

open_terminal_command() {
  KOKORO_READER_COMMAND="$1" /usr/bin/osascript <<'APPLESCRIPT'
set commandText to system attribute "KOKORO_READER_COMMAND"
tell application "Terminal"
  activate
  do script commandText
end tell
APPLESCRIPT
}

ensure_payload() {
  local output
  if ! output="$(KOKORO_READER_NODE="$BUNDLED_NODE" "$SOURCE_INSTALLER" --payload-only 2>&1)"; then
    show_error "$output"
    return 1
  fi
  if [[ ! -x "$STABLE_RUNTIME/node/bin/node" || ! -f "$STABLE_RUNTIME/dist/cli.js" ]]; then
    show_error "The private Kokoro Reader runtime is incomplete. Reinstall the app and try again."
    return 1
  fi
}

if [[ ! -x "$BUNDLED_NODE" ]]; then
  show_error "This copy of Kokoro Reader is damaged because its bundled Node.js runtime is missing."
  exit 1
fi

choice="${1:-}"
if [[ -z "$choice" ]]; then
  choice="$(show_dialog)"
fi

case "$choice" in
  "Open Reader"|"open")
    ensure_payload
    export HF_HOME="$APP_SUPPORT/huggingface"
    export HF_HUB_OFFLINE=1
    cd "$STABLE_RUNTIME"
    exec "$STABLE_RUNTIME/node/bin/node" "$STABLE_RUNTIME/dist/cli.js"
    ;;
  "Install Services"|"install")
    install_output=""
    if ! install_output="$(KOKORO_READER_NODE="$BUNDLED_NODE" "$SOURCE_INSTALLER" 2>&1)"; then
      show_error "$install_output"
      exit 1
    fi
    /usr/bin/osascript -e 'display notification "Services, daemon, and menu bar helper installed." with title "Kokoro Reader"'
    ;;
  "Setup Kokoro"|"setup")
    ensure_payload
    printf -v quoted_script '%q' "$STABLE_RUNTIME/scripts/setup-kokoro.sh"
    open_terminal_command "bash $quoted_script; result=\$?; echo; if [ \$result -eq 0 ]; then echo 'Kokoro Reader setup finished.'; else echo 'Kokoro Reader setup failed.'; fi; exit \$result"
    ;;
  *)
    exit 0
    ;;
esac
LAUNCHER
chmod 755 "$MACOS_DIR/Kokoro Reader"

/usr/bin/plutil -lint "$CONTENTS_DIR/Info.plist" >/dev/null

sign_component() {
  local path="$1"
  shift
  if [[ "$SIGN_IDENTITY" == "-" ]]; then
    codesign --force --sign - "$@" "$path"
  else
    codesign --force --sign "$SIGN_IDENTITY" --options runtime --timestamp "$@" "$path"
  fi
}

sign_component "$RESOURCES_NODE_DIR/node" --entitlements "$NODE_ENTITLEMENTS"
sign_component "$APP_RESOURCES_DIR/native/KokoroReaderMenuBar"

PAYLOAD_ID="$({
  find "$APP_RESOURCES_DIR" -type f -print | LC_ALL=C sort | while IFS= read -r payload_file; do
    relative_path="${payload_file#"$APP_RESOURCES_DIR/"}"
    printf '%s  %s\n' "$(/usr/bin/shasum -a 256 "$payload_file" | awk '{print $1}')" "$relative_path"
  done
  printf '%s  %s\n' "$(/usr/bin/shasum -a 256 "$RESOURCES_NODE_DIR/node" | awk '{print $1}')" "node/bin/node"
  printf '%s  %s\n' "$(/usr/bin/shasum -a 256 "$RESOURCES_DIR/node/LICENSE" | awk '{print $1}')" "node/LICENSE"
  printf '%s  %s\n' "$(/usr/bin/shasum -a 256 "$RESOURCES_DIR/node/VERSION" | awk '{print $1}')" "node/VERSION"
} | /usr/bin/shasum -a 256 | awk '{print $1}')"
printf '%s\n' "$PAYLOAD_ID" > "$APP_RESOURCES_DIR/payload.sha256"

sign_component "$APP_DIR"
validate_system_dylibs "$RESOURCES_NODE_DIR/node"
codesign --verify --deep --strict --verbose=2 "$APP_DIR"

/usr/bin/ditto -c -k --sequesterRsrc --keepParent "$APP_DIR" "$ZIP_PATH"
test -s "$ZIP_PATH"

if [[ -n "$NOTARY_PROFILE" ]]; then
  xcrun notarytool submit "$ZIP_PATH" --keychain-profile "$NOTARY_PROFILE" --wait
  xcrun stapler staple "$APP_DIR"
  xcrun stapler validate "$APP_DIR"
  spctl --assess --type execute --verbose=2 "$APP_DIR"
  codesign --verify --deep --strict --verbose=2 "$APP_DIR"
  rm -f "$ZIP_PATH"
  /usr/bin/ditto -c -k --sequesterRsrc --keepParent "$APP_DIR" "$ZIP_PATH"
  test -s "$ZIP_PATH"
fi

echo "Built: $APP_DIR"
echo "Packaged: $ZIP_PATH"
echo "Architecture: $RUNTIME_ARCH"
if [[ "$SIGN_IDENTITY" == "-" ]]; then
  echo "Signing: ad hoc (local/test build)"
else
  echo "Signing: $SIGN_IDENTITY with hardened runtime and secure timestamp"
fi
