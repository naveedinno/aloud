import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const installer = read('../scripts/install-macos-service.sh');
const uninstaller = read('../scripts/uninstall-macos-service.sh');
const appBuilder = read('../scripts/build-macos-app.sh');
const dmgBuilder = read('../scripts/build-macos-dmg.sh');
const setup = read('../scripts/setup-aloud.sh');
const clean = read('../scripts/clean.sh');
const stopOwnedDaemon = read('../scripts/stop-owned-daemon.sh');
const requirementsLock = read('../requirements-kokoro-py312.lock.txt');
const packageJson = JSON.parse(read('../package.json'));

test('macOS service installer creates all owned workflows', () => {
  assert.match(installer, /local workflow_dir="\$SERVICES_DIR\/\$service_name\.workflow"/);
  assert.match(installer, /install_workflow "Read Selection Aloud"/);
  assert.match(installer, /install_workflow "Stop Aloud"/);
  assert.match(installer, /"Heart\|af_heart"/);
  assert.match(installer, /"Daniel\|bm_daniel"/);
  assert.match(installer, /"Slow\|0\.8"/);
  assert.match(installer, /"Fast\|1\.25"/);
  assert.match(installer, /<key>NSServices<\/key>/);
  assert.match(installer, /<string>public\.utf8-plain-text<\/string>/);
  assert.match(installer, /com\.apple\.Automator\.text/);
});

test('macOS service installer persists only its stable private runtime', () => {
  assert.match(installer, /RUNTIME_VERSION_DIR="\$RUNTIME_ROOT\/\$PACKAGE_VERSION"/);
  assert.match(installer, /RUNTIME_CURRENT="\$RUNTIME_ROOT\/current"/);
  assert.match(installer, /Installing a stable private runtime/);
  assert.match(installer, /ALOUD_NODE/);
  assert.match(installer, /"\$SOURCE_ROOT\/node\/bin\/node" "\$SOURCE_ROOT\/\.\.\/node\/bin\/node"/);
  assert.match(installer, /cp "\$SOURCE_NODE" "\$staging_dir\/node\/bin\/node"/);
  assert.match(installer, /APP_EXECUTABLE="\$RUNTIME_CURRENT\/dist\/cli\.js"/);
  assert.match(installer, /INSTALLER_PATH="\$RUNTIME_CURRENT\/scripts\/install-macos-service\.sh"/);
  assert.match(installer, /SOURCE_PAYLOAD_ID/);
  assert.match(installer, /payload\.sha256/);
  assert.match(installer, /installed_payload_id.*!=.*SOURCE_PAYLOAD_ID/);
  assert.match(installer, /--payload-only/);
  assert.doesNotMatch(installer, /<string>\/Volumes\//);
  assert.doesNotMatch(installer, /<string>.*AppTranslocation/);
});

test('Aloud installer migrates the former product identity without discarding local data', () => {
  assert.match(installer, /LEGACY_APP_SUPPORT=.*Application Support\/Kokoro Reader/);
  assert.match(installer, /mv "\$LEGACY_APP_SUPPORT" "\$APP_SUPPORT"/);
  assert.match(installer, /local\.kokoro-reader\.daemon/);
  assert.match(installer, /Read Aloud with Kokoro\.workflow/);
  assert.match(stopOwnedDaemon, /Kokoro Reader\.app\/Contents\/Resources\/app\/dist\/cli\.js daemon/);
  assert.ok(installer.indexOf('migrate_legacy_install') < installer.indexOf('install_runtime_payload'));
});

test('Services and LaunchAgents use scoped stop behavior and private logs', () => {
  assert.match(installer, /\$APP_EXECUTABLE" stop-daemon/);
  assert.doesNotMatch(installer, /\bpkill\b/);
  assert.doesNotMatch(installer, /\bkillall\b/);
  assert.doesNotMatch(installer, /\/tmp\/aloud-(daemon|menubar)/);
  assert.match(installer, /\$LOGS_DIR\/daemon\.log/);
  assert.match(installer, /\$LOGS_DIR\/menubar\.log/);
  assert.match(installer, /launchctl bootstrap/);
  assert.match(installer, /launchctl print/);
  assert.doesNotMatch(installer, /launchctl bootstrap[^\n]+\|\| true/);
  assert.match(installer, /stop-owned-daemon\.sh/);
  assert.match(installer, /Verified legacy-daemon handoff complete/);
  assert.match(installer, /Installed and restarted the managed daemon/);
  assert.match(uninstaller, /stop-owned-daemon\.sh/);
  assert.match(stopOwnedDaemon, /shutdown-daemon/);
  assert.match(stopOwnedDaemon, /lsof.*-iTCP:/s);
  assert.match(stopOwnedDaemon, /is_owned_command/);
  assert.match(stopOwnedDaemon, /Aloud\.app\/Contents\/Resources\/app\/dist\/cli\.js daemon/);
  assert.match(stopOwnedDaemon, /kill -TERM "\$pid"/);
  assert.match(stopOwnedDaemon, /kill -KILL "\$pid"/);
  assert.doesNotMatch(stopOwnedDaemon, /\bpkill\b|\bkillall\b/);
  assert.ok(stopOwnedDaemon.indexOf('is_owned_command "$command"') < stopOwnedDaemon.indexOf('shutdown-daemon'));
});

test('uninstaller removes only named Aloud resources', () => {
  assert.match(packageJson.scripts['uninstall:macos-service'], /uninstall-macos-service\.sh/);
  assert.match(uninstaller, /local\.aloud\.daemon/);
  assert.match(uninstaller, /local\.aloud\.menubar/);
  assert.match(uninstaller, /"Read Selection Aloud"/);
  assert.match(uninstaller, /"Kokoro Speaker - Daniel"/);
  assert.match(uninstaller, /"\$APP_SUPPORT\/tts-cache"/);
  assert.match(uninstaller, /"\$APP_SUPPORT\/preferences\.json"/);
  assert.match(uninstaller, /"\$APP_SUPPORT\/setup-manifest\.json"/);
  assert.match(uninstaller, /Refusing to remove an unexpected Application Support path/);
  assert.ok(uninstaller.indexOf('unsafe HOME directory') < uninstaller.indexOf('remove_launch_agent "local.aloud.menubar"'));
  assert.doesNotMatch(uninstaller, /\bpkill\b|\bkillall\b/);
  assert.doesNotMatch(uninstaller, /rm -rf ["']?\$HOME["']?\s/);
});

test('Kokoro setup is Python 3.12, dependency, and model revision locked', () => {
  assert.equal(packageJson.scripts['setup:aloud'], 'bash scripts/setup-aloud.sh');
  assert.match(setup, /Python 3\.12/);
  assert.match(setup, /requirements-kokoro-py312\.lock\.txt/);
  assert.match(setup, /pip==\$PIP_VERSION/);
  assert.match(setup, /MODEL_REVISION="f3ff3571791e39611d31c381e3a41a3af07b4987"/);
  assert.match(setup, /export HF_HUB_OFFLINE=0/);
  assert.match(setup, /export TRANSFORMERS_OFFLINE=0/);
  assert.match(setup, /VENV_BACKUP=/);
  assert.match(setup, /SETUP_MANIFEST_BACKUP=/);
  assert.match(setup, /mv "\$VENV_DIR" "\$VENV_BACKUP"/);
  assert.match(setup, /mv "\$SETUP_MANIFEST" "\$SETUP_MANIFEST_BACKUP"/);
  assert.match(setup, /restore_previous_setup/);
  assert.match(setup, /setup-manifest\.json/);
  assert.match(setup, /"schemaVersion": 2/);
  assert.match(setup, /pocket-tts/);
  assert.match(setup, /POCKET_REQUIREMENTS_LOCK/);
  assert.match(setup, /"status": "complete"/);
  assert.match(setup, /"requirementsLockSha256"/);
  assert.match(setup, /mv -f "\$SETUP_MANIFEST_TEMP" "\$SETUP_MANIFEST"/);
  assert.match(setup, /snapshot_download\(repo_id=repo_id, revision=revision/);
  assert.match(setup, /refs_dir \/ "main"/);
  assert.match(setup, /write_text\(revision, encoding="utf-8"\)/);
  assert.doesNotMatch(setup, /write_text\(f"\{revision\}\\n"/);
  assert.match(requirementsLock, /^kokoro==0\.9\.4$/m);
  assert.match(requirementsLock, /^soundfile==0\.14\.0$/m);
  assert.match(requirementsLock, /^torch==2\.12\.1$/m);
  assert.doesNotMatch(setup, /kokoro>=/);
});

test('builds clean generated JavaScript before compiling', () => {
  assert.equal(packageJson.scripts.build, 'npm run clean:dist && tsc');
  assert.equal(packageJson.scripts['clean:dist'], 'bash scripts/clean.sh --dist-only');
  assert.match(clean, /rm -rf "\$REPO_DIR\/dist"/);
  assert.match(clean, /rm -rf "\$REPO_DIR\/build"/);
});

test('macOS app builder packages the complete bundled runtime', () => {
  assert.match(appBuilder, /requirements-kokoro-py312\.lock\.txt/);
  assert.match(appBuilder, /uninstall-macos-service\.sh/);
  assert.match(appBuilder, /run-aloud\.sh/);
  assert.match(appBuilder, /Resources\/node\/bin/);
  assert.match(appBuilder, /native\/AloudMenuBar/);
  assert.match(appBuilder, /NODE_LICENSE_FILE/);
  assert.match(appBuilder, /node\/LICENSE/);
  assert.match(appBuilder, /payload\.sha256/);
  assert.match(appBuilder, /ensure_payload/);
  assert.match(appBuilder, /STABLE_RUNTIME="\$APP_SUPPORT\/runtime\/current"/);
  assert.match(appBuilder, /exec "\$STABLE_RUNTIME\/node\/bin\/node"/);
  assert.doesNotMatch(appBuilder, /command -v node[^\n]+LAUNCHER/);
});

test('macOS artifacts derive version and expose explicit architecture', () => {
  assert.match(appBuilder, /APP_VERSION=.*package\.json/);
  assert.match(appBuilder, /RUNTIME_ARCH="arm64"/);
  assert.match(appBuilder, /RUNTIME_ARCH="x86_64"/);
  assert.match(appBuilder, /lipo -archs "\$NODE_SOURCE"/);
  assert.match(appBuilder, /otool -L "\$binary"/);
  assert.match(appBuilder, /\/System\/Library\/\*\|\/usr\/lib\/\*/);
  assert.match(appBuilder, /Refusing to package a non-portable runtime/);
  assert.match(appBuilder, /swiftc -target "\$RUNTIME_ARCH-apple-macosx13\.0"/);
  assert.match(appBuilder, /validate_macos_target "\$NATIVE_HELPER" "13\.0"/);
  assert.match(appBuilder, /\$APP_NAME-\$APP_VERSION-macos-\$RUNTIME_ARCH/);
  assert.match(appBuilder, /runtime-architecture\.txt/);
  assert.match(appBuilder, /printf -v quoted_script '%q'/);
  assert.doesNotMatch(appBuilder, /<string>0\.1\.0<\/string>/);
});

test('macOS release pipeline supports hardened signing, notarization, and verification', () => {
  assert.match(appBuilder, /MACOS_SIGN_IDENTITY/);
  assert.match(appBuilder, /notarytool submit "\$ZIP_PATH"/);
  assert.match(appBuilder, /stapler staple "\$APP_DIR"/);
  assert.match(appBuilder, /stapler validate "\$APP_DIR"/);
  assert.match(appBuilder, /--options runtime --timestamp/);
  assert.match(appBuilder, /node\.entitlements/);
  assert.match(appBuilder, /codesign --verify --deep --strict/);
  assert.doesNotMatch(appBuilder, /codesign --force --deep --sign/);
  assert.match(dmgBuilder, /hdiutil verify "\$DMG_PATH"/);
  assert.match(dmgBuilder, /MACOS_NOTARY_PROFILE/);
  assert.match(dmgBuilder, /notarytool submit/);
  assert.match(dmgBuilder, /stapler staple/);
  assert.match(dmgBuilder, /stapler validate/);
  assert.match(dmgBuilder, /spctl --assess/);

  const nestedNodeSign = appBuilder.indexOf('sign_component "$RESOURCES_NODE_DIR/node"');
  const payloadIdentity = appBuilder.indexOf('PAYLOAD_ID="$({');
  const outerAppSign = appBuilder.indexOf('sign_component "$APP_DIR"');
  assert.ok(nestedNodeSign >= 0 && nestedNodeSign < payloadIdentity);
  assert.ok(payloadIdentity < outerAppSign);

  const appSubmission = appBuilder.indexOf('notarytool submit "$ZIP_PATH"');
  const appStaple = appBuilder.indexOf('stapler staple "$APP_DIR"');
  const stapledZip = appBuilder.indexOf(
    '/usr/bin/ditto -c -k --sequesterRsrc --keepParent "$APP_DIR" "$ZIP_PATH"',
    appStaple,
  );
  assert.ok(appSubmission >= 0 && appSubmission < appStaple);
  assert.ok(appStaple < stapledZip);
});
