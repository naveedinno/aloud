import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const script = readFileSync(new URL('../scripts/install-macos-service.sh', import.meta.url), 'utf8');
const appBuildScript = readFileSync(new URL('../scripts/build-macos-app.sh', import.meta.url), 'utf8');
const setupScript = readFileSync(new URL('../scripts/setup-kokoro.sh', import.meta.url), 'utf8');
const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const dmgBuildScriptPath = new URL('../scripts/build-macos-dmg.sh', import.meta.url);
const dmgBuildScript = existsSync(dmgBuildScriptPath) ? readFileSync(dmgBuildScriptPath, 'utf8') : '';

test('macOS service installer creates the expected workflow bundle', () => {
  assert.match(script, /local workflow_dir="\$SERVICES_DIR\/\$service_name\.workflow"/);
  assert.match(script, /install_workflow "Read Aloud with Kokoro"/);
  assert.match(script, /install_workflow "Stop Kokoro Reader"/);
  assert.match(script, /"Heart\|af_heart"/);
  assert.match(script, /"Daniel\|bm_daniel"/);
  assert.match(script, /"Slow\|0\.8"/);
  assert.match(script, /"Fast\|1\.25"/);
  assert.match(script, /\/Library\/Services/);
  assert.doesNotMatch(script, /prepare-controller/);
  assert.match(script, /local\.kokoro-reader\.daemon\.plist/);
  assert.match(script, /local\.kokoro-reader\.menubar\.plist/);
  assert.match(script, /install_daemon/);
  assert.match(script, /install_menubar/);
  assert.match(script, /prepare-menubar/);
});

test('macOS service installer declares an indexed Services menu item', () => {
  assert.match(script, /<key>NSServices<\/key>/);
  assert.match(script, /<key>NSMenuItem<\/key>/);
  assert.match(script, /<string>\$service_name<\/string>/);
  assert.match(script, /<string>runWorkflowAsService<\/string>/);
  assert.match(script, /<key>NSSendTypes<\/key>/);
  assert.match(script, /<string>public\.utf8-plain-text<\/string>/);
});

test('macOS service installer accepts selected text and runs the speak command', () => {
  assert.match(script, /com\.apple\.Automator\.text/);
  assert.match(script, /\$APP_EXECUTABLE" speak --stdin --no-open --daemon/);
  assert.doesNotMatch(script, /\$APP_EXECUTABLE" speak --stdin --no-open --controller --daemon/);
  assert.match(script, /--voice \$voice/);
  assert.match(script, /--rate \$rate/);
  assert.match(script, /stop-daemon/);
  assert.match(script, /pkill -x afplay/);
  assert.doesNotMatch(script, /KokoroReaderOverlay/);
  assert.doesNotMatch(script, /pkill -f "kokoro_worker\.py"/);
});

test('macOS service installer starts the menu bar helper', () => {
  assert.match(script, /MENUBAR_EXECUTABLE="\$HOME\/Library\/Application Support\/Kokoro Reader\/menubar\/KokoroReaderMenuBar"/);
  assert.match(script, /<string>local\.kokoro-reader\.menubar<\/string>/);
  assert.match(script, /<string>\$MENUBAR_EXECUTABLE<\/string>/);
  assert.match(script, /<string>\$APP_EXECUTABLE<\/string>/);
  assert.match(script, /kokoro-reader-menubar\.log/);
});

test('macOS service installer refreshes LaunchServices registration', () => {
  assert.match(script, /lsregister -r -domain local -domain system -domain user/);
});

test('Kokoro setup is owned by Kokoro Reader', () => {
  assert.equal(packageJson.scripts['setup:kokoro'], 'bash scripts/setup-kokoro.sh');
  assert.match(setupScript, /Application Support\/Kokoro Reader/);
  assert.match(setupScript, /kokoro-venv/);
  assert.match(setupScript, /brew install espeak-ng/);
  assert.match(setupScript, /pip install "kokoro>=0\.9\.4" soundfile torch/);
});

test('macOS app bundle builder packages the runtime app', () => {
  assert.equal(packageJson.scripts['build:macos-app'], 'npm run build && bash scripts/build-macos-app.sh');
  assert.match(appBuildScript, /APP_NAME="Kokoro Reader"/);
  assert.match(appBuildScript, /APP_DIR="\$BUILD_DIR\/\$APP_NAME\.app"/);
  assert.match(appBuildScript, /CFBundlePackageType/);
  assert.match(appBuildScript, /<string>APPL<\/string>/);
  assert.match(appBuildScript, /Resources\/app/);
  assert.match(appBuildScript, /cp -R "\$REPO_DIR\/assets\/\." "\$APP_RESOURCES_DIR\/assets\/"/);
  assert.match(appBuildScript, /scripts\/install-macos-service\.sh/);
  assert.match(appBuildScript, /scripts\/setup-kokoro\.sh/);
  assert.match(appBuildScript, /display dialog messageText with title "Kokoro Reader"/);
  assert.doesNotMatch(appBuildScript, /cancel button "Setup Kokoro"/);
  assert.match(appBuildScript, /ditto -c -k --sequesterRsrc --keepParent/);
});

test('macOS app bundle includes a bundled Node runtime', () => {
  assert.match(appBuildScript, /RESOURCES_NODE_DIR="\$RESOURCES_DIR\/node\/bin"/);
  assert.match(appBuildScript, /NODE_SOURCE="\$\{NODE_SOURCE:-\$\(command -v node\)\}"/);
  assert.match(appBuildScript, /cp "\$NODE_SOURCE" "\$RESOURCES_NODE_DIR\/node"/);
  assert.match(appBuildScript, /BUNDLED_NODE="\$APP_DIR\/Resources\/node\/bin\/node"/);
  assert.match(appBuildScript, /\[\[ -x "\$BUNDLED_NODE" \]\]/);
  assert.match(appBuildScript, /codesign --force --deep --sign - "\$APP_DIR"/);
});

test('macOS DMG builder stages the app bundle at the volume root', () => {
  assert.equal(packageJson.scripts['build:macos-dmg'], 'npm run build:macos-app && bash scripts/build-macos-dmg.sh');
  assert.match(dmgBuildScript, /STAGING_DIR="\$BUILD_DIR\/dmg-staging"/);
  assert.match(dmgBuildScript, /ditto "\$APP_DIR" "\$STAGING_DIR\/\$APP_NAME\.app"/);
  assert.match(dmgBuildScript, /ln -s \/Applications "\$STAGING_DIR\/Applications"/);
  assert.match(dmgBuildScript, /hdiutil create/);
});
