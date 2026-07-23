#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This installer only works on macOS." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SOURCE_EXECUTABLE="$SOURCE_ROOT/dist/cli.js"
SOURCE_NODE="${ALOUD_NODE:-}"
MODE="${1:-install}"

if [[ "$MODE" != "install" && "$MODE" != "--payload-only" ]]; then
  echo "Usage: $0 [--payload-only]" >&2
  exit 2
fi

if [[ -z "$SOURCE_NODE" ]]; then
  for BUNDLED_NODE in "$SOURCE_ROOT/node/bin/node" "$SOURCE_ROOT/../node/bin/node"; do
    if [[ -x "$BUNDLED_NODE" ]]; then
      SOURCE_NODE="$BUNDLED_NODE"
      break
    fi
  done
fi

if [[ -z "$SOURCE_NODE" ]]; then
  SOURCE_NODE="$(command -v node || true)"
fi

if [[ -z "$SOURCE_NODE" || ! -x "$SOURCE_NODE" ]]; then
  echo "Aloud could not find its bundled Node.js runtime." >&2
  exit 1
fi

if ! "$SOURCE_NODE" -e 'const major = Number(process.versions.node.split(".")[0]); process.exit(major >= 20 ? 0 : 1);'; then
  echo "Aloud requires Node.js 20 or newer." >&2
  exit 1
fi

if [[ ! -f "$SOURCE_ROOT/package.json" || ! -f "$SOURCE_EXECUTABLE" ]]; then
  echo "Aloud's runtime payload is incomplete at: $SOURCE_ROOT" >&2
  exit 1
fi

PACKAGE_VERSION="$("$SOURCE_NODE" -p 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).version' "$SOURCE_ROOT/package.json")"
if [[ ! "$PACKAGE_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "package.json must contain a numeric x.y.z version; found: $PACKAGE_VERSION" >&2
  exit 1
fi

umask 077
APP_SUPPORT="$HOME/Library/Application Support/Aloud"
LEGACY_APP_SUPPORT="$HOME/Library/Application Support/Kokoro Reader"
RUNTIME_ROOT="$APP_SUPPORT/runtime"
RUNTIME_VERSION_DIR="$RUNTIME_ROOT/$PACKAGE_VERSION"
RUNTIME_CURRENT="$RUNTIME_ROOT/current"
LOGS_DIR="$APP_SUPPORT/logs"
SERVICES_DIR="$HOME/Library/Services"
LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"
DAEMON_PLIST="$LAUNCH_AGENTS_DIR/local.aloud.daemon.plist"
MENUBAR_PLIST="$LAUNCH_AGENTS_DIR/local.aloud.menubar.plist"
MENUBAR_EXECUTABLE="$HOME/Library/Application Support/Aloud/menubar/AloudMenuBarCurrent"
LEGACY_DAEMON_PLIST="$LAUNCH_AGENTS_DIR/local.kokoro-reader.daemon.plist"
LEGACY_MENUBAR_PLIST="$LAUNCH_AGENTS_DIR/local.kokoro-reader.menubar.plist"

migrate_legacy_install() {
  launchctl bootout "gui/$(id -u)" "$LEGACY_MENUBAR_PLIST" >/dev/null 2>&1 || true
  launchctl bootout "gui/$(id -u)" "$LEGACY_DAEMON_PLIST" >/dev/null 2>&1 || true
  launchctl remove "local.kokoro-reader.menubar" >/dev/null 2>&1 || true
  launchctl remove "local.kokoro-reader.daemon" >/dev/null 2>&1 || true
  rm -f "$LEGACY_MENUBAR_PLIST" "$LEGACY_DAEMON_PLIST"

  if [[ -d "$LEGACY_APP_SUPPORT" && ! -e "$APP_SUPPORT" ]]; then
    mv "$LEGACY_APP_SUPPORT" "$APP_SUPPORT"
    echo "Migrated the existing local models, cache, preferences, and runtime to Aloud."
  fi

  rm -rf -- \
    "$SERVICES_DIR/Read Aloud with Kokoro.workflow" \
    "$SERVICES_DIR/Stop Kokoro Reader.workflow"
}

migrate_legacy_install

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

compute_source_payload_manifest() {
  local payload_paths=(
    "$SOURCE_ROOT/dist"
    "$SOURCE_ROOT/assets"
    "$SOURCE_ROOT/native"
    "$SOURCE_ROOT/package.json"
    "$SOURCE_ROOT/README.md"
    "$SOURCE_ROOT/requirements-kokoro-py312.lock.txt"
    "$SOURCE_ROOT/requirements-pocket-py312.lock.txt"
    "$SOURCE_ROOT/scripts/install-macos-service.sh"
    "$SOURCE_ROOT/scripts/uninstall-macos-service.sh"
    "$SOURCE_ROOT/scripts/setup-aloud.sh"
    "$SOURCE_ROOT/scripts/run-aloud.sh"
    "$SOURCE_ROOT/scripts/stop-owned-daemon.sh"
  )
  {
    for payload_path in "${payload_paths[@]}"; do
      if [[ -d "$payload_path" ]]; then
        find "$payload_path" -type f -print
      elif [[ -f "$payload_path" ]]; then
        printf '%s\n' "$payload_path"
      fi
    done
  } | LC_ALL=C sort | while IFS= read -r payload_file; do
    relative_path="${payload_file#"$SOURCE_ROOT/"}"
    printf '%s  %s\n' "$(/usr/bin/shasum -a 256 "$payload_file" | awk '{print $1}')" "$relative_path"
  done
  printf '%s  %s\n' "$(/usr/bin/shasum -a 256 "$SOURCE_NODE" | awk '{print $1}')" "node/bin/node"
  for metadata_name in LICENSE VERSION; do
    for metadata_path in "$SOURCE_ROOT/node/$metadata_name" "$SOURCE_ROOT/../node/$metadata_name"; do
      if [[ -f "$metadata_path" ]]; then
        printf '%s  %s\n' "$(/usr/bin/shasum -a 256 "$metadata_path" | awk '{print $1}')" "node/$metadata_name"
        break
      fi
    done
  done
}

SOURCE_PAYLOAD_ID="$(compute_source_payload_manifest | /usr/bin/shasum -a 256 | awk '{print $1}')"
if [[ -f "$SOURCE_ROOT/payload.sha256" ]]; then
  PACKAGED_PAYLOAD_ID="$(tr -d '[:space:]' < "$SOURCE_ROOT/payload.sha256")"
  if [[ ! "$PACKAGED_PAYLOAD_ID" =~ ^[0-9a-f]{64}$ || "$PACKAGED_PAYLOAD_ID" != "$SOURCE_PAYLOAD_ID" ]]; then
    echo "Aloud's packaged payload identity does not match its files; refusing to install a damaged bundle." >&2
    exit 1
  fi
fi

install_runtime_payload() {
  mkdir -p "$APP_SUPPORT" "$RUNTIME_ROOT" "$LOGS_DIR"
  chmod 700 "$APP_SUPPORT" "$RUNTIME_ROOT" "$LOGS_DIR"

  case "$SOURCE_ROOT" in
    /Volumes/*|*/AppTranslocation/*)
      echo "Installing a stable private runtime; no mounted or translocated app path will be persisted."
      ;;
  esac

  local installed_payload_id=""
  if [[ -f "$RUNTIME_VERSION_DIR/payload.sha256" ]]; then
    installed_payload_id="$(tr -d '[:space:]' < "$RUNTIME_VERSION_DIR/payload.sha256")"
  fi

  if [[ ! -x "$RUNTIME_VERSION_DIR/node/bin/node" || ! -f "$RUNTIME_VERSION_DIR/dist/cli.js" || "$installed_payload_id" != "$SOURCE_PAYLOAD_ID" || "${ALOUD_FORCE_PAYLOAD:-0}" == "1" ]]; then
    local staging_dir="$RUNTIME_ROOT/.staging-$PACKAGE_VERSION-$$"
    local old_dir="$RUNTIME_ROOT/.old-$PACKAGE_VERSION-$$"
    rm -rf "$staging_dir"
    mkdir -p "$staging_dir/dist" "$staging_dir/scripts" "$staging_dir/assets" "$staging_dir/node/bin"

    /usr/bin/ditto "$SOURCE_ROOT/dist" "$staging_dir/dist"
    if [[ -d "$SOURCE_ROOT/assets" ]]; then
      /usr/bin/ditto "$SOURCE_ROOT/assets" "$staging_dir/assets"
    fi
    if [[ -d "$SOURCE_ROOT/native" ]]; then
      /usr/bin/ditto "$SOURCE_ROOT/native" "$staging_dir/native"
    fi

    for payload_file in package.json README.md requirements-kokoro-py312.lock.txt requirements-pocket-py312.lock.txt; do
      if [[ ! -f "$SOURCE_ROOT/$payload_file" ]]; then
        echo "Missing runtime payload file: $SOURCE_ROOT/$payload_file" >&2
        rm -rf "$staging_dir"
        return 1
      fi
      cp "$SOURCE_ROOT/$payload_file" "$staging_dir/$payload_file"
    done

    for payload_script in install-macos-service.sh uninstall-macos-service.sh setup-aloud.sh run-aloud.sh stop-owned-daemon.sh; do
      if [[ ! -f "$SOURCE_ROOT/scripts/$payload_script" ]]; then
        echo "Missing runtime script: $SOURCE_ROOT/scripts/$payload_script" >&2
        rm -rf "$staging_dir"
        return 1
      fi
      cp "$SOURCE_ROOT/scripts/$payload_script" "$staging_dir/scripts/$payload_script"
    done

    cp "$SOURCE_NODE" "$staging_dir/node/bin/node"
    for metadata_name in LICENSE VERSION; do
      for metadata_path in "$SOURCE_ROOT/node/$metadata_name" "$SOURCE_ROOT/../node/$metadata_name"; do
        if [[ -f "$metadata_path" ]]; then
          cp "$metadata_path" "$staging_dir/node/$metadata_name"
          break
        fi
      done
    done
    printf '%s\n' "$SOURCE_PAYLOAD_ID" > "$staging_dir/payload.sha256"
    chmod 700 "$staging_dir/node/bin/node" "$staging_dir/scripts/"*.sh

    if ! "$staging_dir/node/bin/node" -e 'const major = Number(process.versions.node.split(".")[0]); process.exit(major >= 20 ? 0 : 1);'; then
      echo "The copied Node.js runtime failed validation." >&2
      rm -rf "$staging_dir"
      return 1
    fi

    rm -rf "$old_dir"
    if [[ -e "$RUNTIME_VERSION_DIR" ]]; then
      mv "$RUNTIME_VERSION_DIR" "$old_dir"
    fi
    mv "$staging_dir" "$RUNTIME_VERSION_DIR"
    rm -rf "$old_dir"
  fi

  local next_link="$RUNTIME_ROOT/.current-$$"
  if [[ ( -e "$RUNTIME_CURRENT" || -L "$RUNTIME_CURRENT" ) && ! -L "$RUNTIME_CURRENT" ]]; then
    echo "Refusing to replace an unexpected non-symlink runtime/current path: $RUNTIME_CURRENT" >&2
    return 1
  fi
  rm -f "$next_link"
  ln -s "$PACKAGE_VERSION" "$next_link"
  mv -fh "$next_link" "$RUNTIME_CURRENT"

  if [[ ! -x "$RUNTIME_CURRENT/node/bin/node" || ! -f "$RUNTIME_CURRENT/dist/cli.js" ]]; then
    echo "The stable Aloud runtime failed validation: $RUNTIME_CURRENT" >&2
    return 1
  fi
}

install_runtime_payload

if [[ "$MODE" == "--payload-only" ]]; then
  echo "Runtime ready: $RUNTIME_CURRENT"
  exit 0
fi

REPO_DIR="$RUNTIME_CURRENT"
APP_EXECUTABLE="$RUNTIME_CURRENT/dist/cli.js"
NODE_BIN="$RUNTIME_CURRENT/node/bin/node"
INSTALLER_PATH="$RUNTIME_CURRENT/scripts/install-macos-service.sh"
HF_HOME="$APP_SUPPORT/huggingface"

launchctl bootout "gui/$(id -u)" "$MENUBAR_PLIST" >/dev/null 2>&1 || true
launchctl bootout "gui/$(id -u)" "$DAEMON_PLIST" >/dev/null 2>&1 || true
"$RUNTIME_CURRENT/scripts/stop-owned-daemon.sh" "$NODE_BIN" "$APP_EXECUTABLE"
echo "Verified legacy-daemon handoff complete; replacing it with the managed LaunchAgent."

mkdir -p "$(dirname "$MENUBAR_EXECUTABLE")"
if [[ -x "$RUNTIME_CURRENT/native/AloudMenuBarCurrent" ]]; then
  cp "$RUNTIME_CURRENT/native/AloudMenuBarCurrent" "$MENUBAR_EXECUTABLE"
  chmod 700 "$MENUBAR_EXECUTABLE"
else
  HF_HOME="$HF_HOME" HF_HUB_OFFLINE=1 "$NODE_BIN" "$APP_EXECUTABLE" prepare-menubar >/dev/null 2>&1 || true
fi

if [[ ! -x "$MENUBAR_EXECUTABLE" ]]; then
  echo "The Aloud menu bar helper could not be installed." >&2
  exit 1
fi

service_command() {
  local flags="$1"
  cat <<EOF
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export HF_HOME="$HF_HOME"
export HF_HUB_OFFLINE="1"
cd "$REPO_DIR" || exit 1
"$NODE_BIN" "$APP_EXECUTABLE" speak --stdin --no-open --daemon $flags
EOF
}

stop_command() {
  cat <<EOF
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
"$NODE_BIN" "$APP_EXECUTABLE" stop-daemon >/dev/null 2>&1 || true
EOF
}

install_daemon() {
  local node_xml executable_xml workdir_xml hf_home_xml stdout_xml stderr_xml
  node_xml="$(xml_escape "$NODE_BIN")"
  executable_xml="$(xml_escape "$APP_EXECUTABLE")"
  workdir_xml="$(xml_escape "$REPO_DIR")"
  hf_home_xml="$(xml_escape "$HF_HOME")"
  stdout_xml="$(xml_escape "$LOGS_DIR/daemon.log")"
  stderr_xml="$(xml_escape "$LOGS_DIR/daemon.err.log")"
  mkdir -p "$LAUNCH_AGENTS_DIR" "$LOGS_DIR"
  launchctl bootout "gui/$(id -u)" "$DAEMON_PLIST" >/dev/null 2>&1 || true
  cat > "$DAEMON_PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>local.aloud.daemon</string>
  <key>ProgramArguments</key>
  <array>
    <string>$node_xml</string>
    <string>$executable_xml</string>
    <string>daemon</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$workdir_xml</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>HF_HOME</key>
    <string>$hf_home_xml</string>
    <key>HF_HUB_OFFLINE</key>
    <string>1</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ProcessType</key>
  <string>Background</string>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>$stdout_xml</string>
  <key>StandardErrorPath</key>
  <string>$stderr_xml</string>
</dict>
</plist>
PLIST
  /usr/bin/plutil -lint "$DAEMON_PLIST" >/dev/null
  launchctl bootstrap "gui/$(id -u)" "$DAEMON_PLIST"
  launchctl kickstart -k "gui/$(id -u)/local.aloud.daemon"
  launchctl print "gui/$(id -u)/local.aloud.daemon" >/dev/null
  echo "Installed and restarted the managed daemon: $DAEMON_PLIST"
}

install_menubar() {
  if [[ ! -x "$MENUBAR_EXECUTABLE" ]]; then
    echo "Missing menu bar helper: $MENUBAR_EXECUTABLE" >&2
    return 1
  fi
  local helper_xml node_xml executable_xml workdir_xml installer_xml hf_home_xml stdout_xml stderr_xml
  helper_xml="$(xml_escape "$MENUBAR_EXECUTABLE")"
  node_xml="$(xml_escape "$NODE_BIN")"
  executable_xml="$(xml_escape "$APP_EXECUTABLE")"
  workdir_xml="$(xml_escape "$REPO_DIR")"
  installer_xml="$(xml_escape "$INSTALLER_PATH")"
  hf_home_xml="$(xml_escape "$HF_HOME")"
  stdout_xml="$(xml_escape "$LOGS_DIR/menubar.log")"
  stderr_xml="$(xml_escape "$LOGS_DIR/menubar.err.log")"
  mkdir -p "$LAUNCH_AGENTS_DIR" "$LOGS_DIR"
  launchctl bootout "gui/$(id -u)" "$MENUBAR_PLIST" >/dev/null 2>&1 || true
  cat > "$MENUBAR_PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>local.aloud.menubar</string>
  <key>ProgramArguments</key>
  <array>
    <string>$helper_xml</string>
    <string>$node_xml</string>
    <string>$executable_xml</string>
    <string>$workdir_xml</string>
    <string>$installer_xml</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$workdir_xml</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>HF_HOME</key>
    <string>$hf_home_xml</string>
    <key>HF_HUB_OFFLINE</key>
    <string>1</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>ProcessType</key>
  <string>Interactive</string>
  <key>StandardOutPath</key>
  <string>$stdout_xml</string>
  <key>StandardErrorPath</key>
  <string>$stderr_xml</string>
</dict>
</plist>
PLIST
  /usr/bin/plutil -lint "$MENUBAR_PLIST" >/dev/null
  launchctl bootstrap "gui/$(id -u)" "$MENUBAR_PLIST"
  launchctl kickstart -k "gui/$(id -u)/local.aloud.menubar"
  launchctl print "gui/$(id -u)/local.aloud.menubar" >/dev/null
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
  rm -rf "$workflow_dir"
  mkdir -p "$contents_dir"

  cat > "$info_path" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en_US</string>
  <key>CFBundleIdentifier</key>
  <string>local.aloud.$identifier_suffix</string>
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
install_workflow "Read Selection Aloud" "read-selection-aloud" ""
install_workflow "Stop Aloud" "stop-aloud" "" "$(stop_command)"

for item in "${SPEAKERS[@]}"; do
  IFS='|' read -r label voice <<< "$item"
  install_workflow "Kokoro Speaker - $label" "speaker-$(slugify "$label")" "--voice $voice"
done

for item in "${STYLES[@]}"; do
  IFS='|' read -r label rate <<< "$item"
  install_workflow "Kokoro Style - $label" "style-$(slugify "$label")" "--rate $rate"
done

if [[ "${ALOUD_SKIP_REGISTRATION:-0}" != "1" ]]; then
  LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
  if [[ -x "$LSREGISTER" ]]; then
    # Refresh command: lsregister -r -domain local -domain system -domain user
    "$LSREGISTER" -r -domain local -domain system -domain user >/dev/null 2>&1 || true
  fi

  if [[ -x "/System/Library/CoreServices/pbs" ]]; then
    /System/Library/CoreServices/pbs -update en >/dev/null 2>&1 || true
    /System/Library/CoreServices/pbs -flush en >/dev/null 2>&1 || true
  fi
fi

for candidate in "$RUNTIME_ROOT"/*; do
  if [[ -d "$candidate" && ! -L "$candidate" && "$candidate" != "$RUNTIME_VERSION_DIR" ]]; then
    rm -rf "$candidate"
  fi
done

echo "Installed Aloud $PACKAGE_VERSION using the stable runtime: $RUNTIME_CURRENT"
echo "Logs: $LOGS_DIR"
echo "Select text, right-click, then choose Services > Read Selection Aloud, Kokoro Speaker - ..., or Kokoro Style - ..."
