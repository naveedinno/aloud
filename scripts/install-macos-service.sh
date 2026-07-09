#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This installer only works on macOS." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
APP_EXECUTABLE="$REPO_DIR/dist/cli.js"
SERVICES_DIR="$HOME/Library/Services"
LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"
DAEMON_PLIST="$LAUNCH_AGENTS_DIR/local.kokoro-reader.daemon.plist"
MENUBAR_PLIST="$LAUNCH_AGENTS_DIR/local.kokoro-reader.menubar.plist"
MENUBAR_EXECUTABLE="$HOME/Library/Application Support/Kokoro Reader/menubar/KokoroReaderMenuBar"
NODE_BIN="$(command -v node)"

"$NODE_BIN" "$APP_EXECUTABLE" prepare-menubar >/dev/null 2>&1 || true

SPEAKERS=(
  "Heart|af_heart"
  "Bella|af_bella"
  "Nicole|af_nicole"
  "Sarah|af_sarah"
  "Adam|am_adam"
  "Onyx|am_onyx"
  "Emma|bf_emma"
  "Daniel|bm_daniel"
)

STYLES=(
  "Slow|0.8"
  "Normal|1"
  "Fast|1.25"
)

xml_escape() {
  local value="$1"
  value="${value//&/&amp;}"
  value="${value//</&lt;}"
  value="${value//>/&gt;}"
  printf '%s' "$value"
}

slugify() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | tr -cs '[:alnum:]' '-'
}

service_command() {
  local flags="$1"
  cat <<EOF
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
cd "$REPO_DIR" || exit 1
"$NODE_BIN" "$APP_EXECUTABLE" speak --stdin --no-open --daemon $flags
EOF
}

stop_command() {
  cat <<EOF
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
"$NODE_BIN" "$APP_EXECUTABLE" stop-daemon >/dev/null 2>&1 || true
pkill -x afplay >/dev/null 2>&1 || true
pkill -f "dist/cli.js speak" >/dev/null 2>&1 || true
pkill -f "node dist/cli.js speak" >/dev/null 2>&1 || true
EOF
}

install_daemon() {
  mkdir -p "$LAUNCH_AGENTS_DIR"
  cat > "$DAEMON_PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>local.kokoro-reader.daemon</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE_BIN</string>
    <string>$APP_EXECUTABLE</string>
    <string>daemon</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$REPO_DIR</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/tmp/kokoro-reader-daemon.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/kokoro-reader-daemon.err</string>
</dict>
</plist>
PLIST
  launchctl bootout "gui/$(id -u)" "$DAEMON_PLIST" >/dev/null 2>&1 || true
  launchctl bootstrap "gui/$(id -u)" "$DAEMON_PLIST" >/dev/null 2>&1 || true
  launchctl kickstart -k "gui/$(id -u)/local.kokoro-reader.daemon" >/dev/null 2>&1 || true
  echo "Installed: $DAEMON_PLIST"
}

install_menubar() {
  if [[ ! -x "$MENUBAR_EXECUTABLE" ]]; then
    echo "Skipping menu bar helper; native helper did not compile." >&2
    return
  fi
  mkdir -p "$LAUNCH_AGENTS_DIR"
  cat > "$MENUBAR_PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>local.kokoro-reader.menubar</string>
  <key>ProgramArguments</key>
  <array>
    <string>$MENUBAR_EXECUTABLE</string>
    <string>$NODE_BIN</string>
    <string>$APP_EXECUTABLE</string>
    <string>$REPO_DIR</string>
    <string>$REPO_DIR/scripts/install-macos-service.sh</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$REPO_DIR</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/tmp/kokoro-reader-menubar.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/kokoro-reader-menubar.err</string>
</dict>
</plist>
PLIST
  launchctl bootout "gui/$(id -u)" "$MENUBAR_PLIST" >/dev/null 2>&1 || true
  launchctl bootstrap "gui/$(id -u)" "$MENUBAR_PLIST" >/dev/null 2>&1 || true
  launchctl kickstart -k "gui/$(id -u)/local.kokoro-reader.menubar" >/dev/null 2>&1 || true
  echo "Installed: $MENUBAR_PLIST"
}

install_workflow() {
  local service_name="$1"
  local identifier_suffix="$2"
  local flags="$3"
  local command_source="${4:-}"
  local workflow_dir="$SERVICES_DIR/$service_name.workflow"
  local contents_dir="$workflow_dir/Contents"
  local info_path="$contents_dir/Info.plist"
  local document_path="$contents_dir/document.wflow"
  local command_xml

  if [[ -z "$command_source" ]]; then
    command_source="$(service_command "$flags")"
  fi
  command_xml="$(xml_escape "$command_source")"
  mkdir -p "$contents_dir"

  cat > "$info_path" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en_US</string>
  <key>CFBundleIdentifier</key>
  <string>local.kokoro-reader.$identifier_suffix</string>
  <key>CFBundleName</key>
  <string>$service_name</string>
  <key>CFBundlePackageType</key>
  <string>BNDL</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>NSServices</key>
  <array>
    <dict>
      <key>NSMenuItem</key>
      <dict>
        <key>default</key>
        <string>$service_name</string>
      </dict>
      <key>NSMessage</key>
      <string>runWorkflowAsService</string>
      <key>NSSendTypes</key>
      <array>
        <string>public.utf8-plain-text</string>
      </array>
    </dict>
  </array>
</dict>
</plist>
PLIST

  cat > "$document_path" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>AMApplicationBuild</key>
  <string>521</string>
  <key>AMApplicationVersion</key>
  <string>2.10</string>
  <key>AMDocumentVersion</key>
  <string>2</string>
  <key>actions</key>
  <array>
    <dict>
      <key>action</key>
      <dict>
        <key>AMAccepts</key>
        <dict>
          <key>Container</key>
          <string>List</string>
          <key>Optional</key>
          <true/>
          <key>Types</key>
          <array>
            <string>com.apple.Automator.text</string>
          </array>
        </dict>
        <key>AMActionVersion</key>
        <string>2.0.3</string>
        <key>AMApplication</key>
        <array>
          <string>Automator</string>
        </array>
        <key>AMParameterProperties</key>
        <dict>
          <key>COMMAND_STRING</key>
          <dict/>
          <key>CheckedForUserDefaultShell</key>
          <dict/>
          <key>inputMethod</key>
          <dict/>
          <key>shell</key>
          <dict/>
          <key>source</key>
          <dict/>
        </dict>
        <key>AMProvides</key>
        <dict>
          <key>Container</key>
          <string>List</string>
          <key>Types</key>
          <array>
            <string>com.apple.Automator.nothing</string>
          </array>
        </dict>
        <key>ActionBundlePath</key>
        <string>/System/Library/Automator/Run Shell Script.action</string>
        <key>ActionName</key>
        <string>Run Shell Script</string>
        <key>ActionParameters</key>
        <dict>
          <key>COMMAND_STRING</key>
          <string>$command_xml</string>
          <key>CheckedForUserDefaultShell</key>
          <true/>
          <key>inputMethod</key>
          <integer>0</integer>
          <key>shell</key>
          <string>/bin/zsh</string>
          <key>source</key>
          <string></string>
        </dict>
        <key>BundleIdentifier</key>
        <string>com.apple.RunShellScript</string>
        <key>CFBundleVersion</key>
        <string>2.0.3</string>
        <key>CanShowSelectedItemsWhenRun</key>
        <false/>
        <key>CanShowWhenRun</key>
        <true/>
        <key>Category</key>
        <array>
          <string>AMCategoryUtilities</string>
        </array>
        <key>Class Name</key>
        <string>RunShellScriptAction</string>
        <key>InputUUID</key>
        <string>11111111-1111-1111-1111-111111111111</string>
        <key>Keywords</key>
        <array>
          <string>Shell</string>
          <string>Script</string>
          <string>Command</string>
        </array>
        <key>OutputUUID</key>
        <string>22222222-2222-2222-2222-222222222222</string>
        <key>UUID</key>
        <string>33333333-3333-3333-3333-333333333333</string>
        <key>UnlocalizedApplications</key>
        <array>
          <string>Automator</string>
        </array>
        <key>arguments</key>
        <dict>
          <key>0</key>
          <dict>
            <key>default value</key>
            <integer>0</integer>
            <key>name</key>
            <string>inputMethod</string>
            <key>required</key>
            <string>0</string>
            <key>type</key>
            <string>0</string>
            <key>uuid</key>
            <string>44444444-4444-4444-4444-444444444444</string>
          </dict>
          <key>1</key>
          <dict>
            <key>default value</key>
            <string></string>
            <key>name</key>
            <string>source</string>
            <key>required</key>
            <string>0</string>
            <key>type</key>
            <string>0</string>
            <key>uuid</key>
            <string>55555555-5555-5555-5555-555555555555</string>
          </dict>
        </dict>
      </dict>
      <key>isViewVisible</key>
      <true/>
    </dict>
  </array>
  <key>connectors</key>
  <dict/>
  <key>workflowMetaData</key>
  <dict>
    <key>applicationBundleIDsByPath</key>
    <dict/>
    <key>applicationPaths</key>
    <array/>
    <key>inputTypeIdentifier</key>
    <string>com.apple.Automator.text</string>
    <key>outputTypeIdentifier</key>
    <string>com.apple.Automator.nothing</string>
    <key>presentationMode</key>
    <integer>11</integer>
    <key>processesInput</key>
    <integer>0</integer>
    <key>serviceInputTypeIdentifier</key>
    <string>com.apple.Automator.text</string>
    <key>serviceOutputTypeIdentifier</key>
    <string>com.apple.Automator.nothing</string>
    <key>serviceProcessesInput</key>
    <integer>0</integer>
    <key>systemImageName</key>
    <string>speaker.wave.2.fill</string>
    <key>useAutomaticInputType</key>
    <integer>0</integer>
    <key>workflowTypeIdentifier</key>
    <string>com.apple.Automator.servicesMenu</string>
  </dict>
</dict>
</plist>
PLIST

  /usr/bin/plutil -lint "$info_path" "$document_path" >/dev/null
  echo "Installed: $workflow_dir"
}

mkdir -p "$SERVICES_DIR"

install_daemon
install_menubar
install_workflow "Read Aloud with Kokoro" "read-aloud-with-kokoro" ""
install_workflow "Stop Kokoro Reader" "stop-kokoro-reader" "" "$(stop_command)"

for item in "${SPEAKERS[@]}"; do
  IFS='|' read -r label voice <<< "$item"
  install_workflow "Kokoro Speaker - $label" "speaker-$(slugify "$label")" "--voice $voice"
done

for item in "${STYLES[@]}"; do
  IFS='|' read -r label rate <<< "$item"
  install_workflow "Kokoro Style - $label" "style-$(slugify "$label")" "--rate $rate"
done

LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
if [[ -x "$LSREGISTER" ]]; then
  # Refresh command: lsregister -r -domain local -domain system -domain user
  "$LSREGISTER" -r -domain local -domain system -domain user >/dev/null 2>&1 || true
fi

if [[ -x "/System/Library/CoreServices/pbs" ]]; then
  /System/Library/CoreServices/pbs -update en >/dev/null 2>&1 || true
  /System/Library/CoreServices/pbs -flush en >/dev/null 2>&1 || true
fi

echo "Use these by selecting text, right-clicking, then choosing Services > Read Aloud with Kokoro, Kokoro Speaker - ..., or Kokoro Style - ..."
