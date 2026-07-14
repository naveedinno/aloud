#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This DMG builder only works on macOS." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BUILD_DIR="$REPO_DIR/build"
APP_NAME="Kokoro Reader"
APP_DIR="$BUILD_DIR/$APP_NAME.app"
STAGING_DIR="$BUILD_DIR/dmg-staging"
SIGN_IDENTITY="${MACOS_SIGN_IDENTITY:--}"
NOTARY_PROFILE="${MACOS_NOTARY_PROFILE:-}"

if [[ ! -d "$APP_DIR" ]]; then
  echo "Missing app bundle: $APP_DIR" >&2
  echo "Run: npm run build:macos-app" >&2
  exit 1
fi

APP_VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP_DIR/Contents/Info.plist")"
RUNTIME_ARCH="$(tr -d '[:space:]' < "$APP_DIR/Contents/Resources/runtime-architecture.txt")"
if [[ ! "$APP_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ || ! "$RUNTIME_ARCH" =~ ^(arm64|x86_64)$ ]]; then
  echo "The app bundle has invalid version or architecture metadata." >&2
  exit 1
fi

ARTIFACT_STEM="$APP_NAME-$APP_VERSION-macos-$RUNTIME_ARCH"
DMG_PATH="$BUILD_DIR/$ARTIFACT_STEM.dmg"

codesign --verify --deep --strict --verbose=2 "$APP_DIR"
rm -rf "$STAGING_DIR"
find "$BUILD_DIR" -maxdepth 1 -type f \( -name "$APP_NAME-*-macos-*.dmg" -o -name "$APP_NAME.dmg" \) -delete
mkdir -p "$STAGING_DIR"
/usr/bin/ditto "$APP_DIR" "$STAGING_DIR/$APP_NAME.app"
ln -s /Applications "$STAGING_DIR/Applications"

hdiutil create \
  -volname "$APP_NAME" \
  -srcfolder "$STAGING_DIR" \
  -ov \
  -format UDZO \
  "$DMG_PATH"

hdiutil verify "$DMG_PATH"

if [[ "$SIGN_IDENTITY" != "-" ]]; then
  codesign --force --sign "$SIGN_IDENTITY" --timestamp "$DMG_PATH"
  codesign --verify --strict --verbose=2 "$DMG_PATH"
fi

if [[ -n "$NOTARY_PROFILE" ]]; then
  if [[ "$SIGN_IDENTITY" == "-" ]]; then
    echo "MACOS_NOTARY_PROFILE requires a Developer ID identity in MACOS_SIGN_IDENTITY." >&2
    exit 1
  fi
  xcrun notarytool submit "$DMG_PATH" --keychain-profile "$NOTARY_PROFILE" --wait
  xcrun stapler staple "$DMG_PATH"
  xcrun stapler validate "$DMG_PATH"
  spctl --assess --type open --context context:primary-signature --verbose=2 "$DMG_PATH"
fi

hdiutil verify "$DMG_PATH"
codesign --verify --deep --strict --verbose=2 "$APP_DIR"
if [[ "$SIGN_IDENTITY" != "-" ]]; then
  codesign --verify --strict --verbose=2 "$DMG_PATH"
fi

rm -rf "$STAGING_DIR"
echo "Packaged and verified: $DMG_PATH"
if [[ -n "$NOTARY_PROFILE" ]]; then
  echo "Notarized and stapled with keychain profile: $NOTARY_PROFILE"
elif [[ "$SIGN_IDENTITY" == "-" ]]; then
  echo "Release note: this is an ad-hoc local build, not a notarized distribution."
else
  echo "Release note: Developer ID signed, but not notarized (MACOS_NOTARY_PROFILE was not set)."
fi
