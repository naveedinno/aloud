import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repo = dirname(dirname(fileURLToPath(import.meta.url)));

function executable(path, contents) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
  chmodSync(path, 0o755);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    env: options.env,
    maxBuffer: 10 * 1024 * 1024,
  });
  assert.equal(
    result.status,
    0,
    `${basename(command)} ${args.join(' ')} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  return result;
}

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  await new Promise((resolve) => server.close(resolve));
  return address.port;
}

async function startUnmanagedDaemon(script, port) {
  const child = spawn(process.execPath, [script, 'daemon'], {
    env: { ...process.env, TEST_DAEMON_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('unmanaged daemon did not start')), 5000);
    child.once('error', reject);
    child.stdout.once('data', () => {
      clearTimeout(timer);
      resolve();
    });
  });
  return child;
}

test('clean-room app, DMG, install, and uninstall keep paths stable and scoped', {
  skip: process.platform !== 'darwin',
}, async () => {
  const root = mkdtempSync(join(tmpdir(), 'kokoro reader packaging-'));
  const fixture = join(root, 'source from mounted image');
  const fakeBin = join(root, 'fake-bin');
  const home = join(root, 'clean home');
  const fakeTmp = join(root, 'private tmp');
  const childProcesses = [];
  const hostArch = process.arch === 'arm64' ? 'arm64' : 'x86_64';
  const version = '9.8.7';

  try {
    for (const relative of [
      'scripts/build-macos-app.sh',
      'scripts/build-macos-dmg.sh',
      'scripts/clean.sh',
      'scripts/install-macos-service.sh',
      'scripts/uninstall-macos-service.sh',
      'scripts/setup-aloud.sh',
      'scripts/run-aloud.sh',
      'scripts/stop-owned-daemon.sh',
      'packaging/macos/node.entitlements',
    ]) {
      const target = join(fixture, relative);
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(join(repo, relative), target);
      if (relative.endsWith('.sh')) chmodSync(target, 0o755);
    }
    mkdirSync(join(fixture, 'dist'), { recursive: true });
    mkdirSync(join(fixture, 'assets'), { recursive: true });
    writeFileSync(join(fixture, 'dist', 'cli.js'), '// clean fixture\n');
    writeFileSync(join(fixture, 'assets', 'fixture.txt'), 'asset\n');
    copyFileSync(join(repo, 'assets', 'Aloud.icns'), join(fixture, 'assets', 'Aloud.icns'));
    writeFileSync(join(fixture, 'README.md'), '# Fixture\n');
    writeFileSync(join(fixture, 'requirements-kokoro-py312.lock.txt'), 'kokoro==0.9.4\n');
    writeFileSync(join(fixture, 'requirements-pocket-py312.lock.txt'), 'pocket-tts==2.1.0\n');
    writeFileSync(join(fixture, 'package.json'), JSON.stringify({ name: 'fixture', version }));
    const nodeLicense = join(root, 'Node-LICENSE');
    writeFileSync(nodeLicense, 'Fixture Node.js license and third-party notices\n');
    const legacyDaemonScript = join(root, 'Volumes', 'Aloud.app', 'Contents', 'Resources', 'app', 'dist', 'cli.js');
    mkdirSync(dirname(legacyDaemonScript), { recursive: true });
    writeFileSync(legacyDaemonScript, `const http = require('node:http');
const server = http.createServer((_request, response) => response.end('legacy'));
server.listen(Number(process.env.TEST_DAEMON_PORT), '127.0.0.1', () => console.log('ready'));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
`);
    const daemonPort = await freePort();

    const fakeNode = join(fakeBin, 'node');
    executable(fakeNode, `#!/usr/bin/env bash
set -e
case "\${1:-}" in
  -e) exit 0 ;;
  -p) printf '${version}\\n'; exit 0 ;;
esac
if [[ "\${2:-}" == "prepare-menubar" ]]; then
  helper="$HOME/Library/Application Support/Aloud/menubar/AloudMenuBarCurrent"
  mkdir -p "$(dirname "$helper")"
  printf '#!/usr/bin/env bash\\nexit 0\\n' > "$helper"
  printf 'import Foundation\\nprint("fixture")\\n' > "$helper.swift"
  chmod +x "$helper"
fi
`);
    executable(join(fakeBin, 'lipo'), '#!/usr/bin/env bash\necho "arm64 x86_64"\n');
    executable(join(fakeBin, 'otool'), '#!/usr/bin/env bash\nif [[ "$1" == "-l" ]]; then echo "    minos 11.0"; else echo "$2:"; echo "\\t/usr/lib/libSystem.B.dylib (compatibility version 1.0.0)"; fi\n');
    executable(join(fakeBin, 'codesign'), '#!/usr/bin/env bash\nexit 0\n');
    executable(join(fakeBin, 'launchctl'), '#!/usr/bin/env bash\nexit 0\n');
    executable(join(fakeBin, 'hdiutil'), `#!/usr/bin/env bash
set -e
if [[ "\${1:-}" == "create" ]]; then
  for last; do true; done
  printf 'fixture dmg\\n' > "$last"
elif [[ "\${1:-}" == "verify" ]]; then
  test -s "\${2}"
fi
`);
    executable(join(fakeBin, 'xcrun'), '#!/usr/bin/env bash\nexit 0\n');
    executable(join(fakeBin, 'spctl'), '#!/usr/bin/env bash\nexit 0\n');

    const setupHome = join(root, 'offline setup home');
    const setupOnlineLog = join(root, 'setup-online.log');
    executable(join(fakeBin, 'brew'), '#!/usr/bin/env bash\nexit 0\n');
    executable(join(fakeBin, 'python3.12'), `#!/usr/bin/env bash
set -e
if [[ "\${1:-}" == "-c" ]]; then exit 0; fi
if [[ "\${1:-}" == "-m" && "\${2:-}" == "venv" ]]; then
  mkdir -p "$3/bin"
  cp "$0" "$3/bin/python"
  chmod +x "$3/bin/python"
  exit 0
fi
if [[ "\${1:-}" == "-m" && "\${2:-}" == "pip" && "\${FAIL_PIP:-0}" == "1" ]]; then exit 42; fi
if [[ "\${1:-}" == "-m" ]]; then exit 0; fi
printf '%s %s\\n' "$HF_HUB_OFFLINE" "$TRANSFORMERS_OFFLINE" > ${JSON.stringify(setupOnlineLog)}
printf '{"modelRevision":"%s","pythonVersion":"3.12","schemaVersion":1,"status":"complete"}\\n' "$MODEL_REVISION" > "$SETUP_MANIFEST_TEMP"
chmod 600 "$SETUP_MANIFEST_TEMP"
`);
    run('bash', ['scripts/setup-aloud.sh'], {
      cwd: fixture,
      env: {
        ...process.env,
        HF_HUB_OFFLINE: '1',
        HOME: setupHome,
        PATH: `${fakeBin}:${process.env.PATH}`,
        TRANSFORMERS_OFFLINE: '1',
      },
    });
    assert.equal(readFileSync(setupOnlineLog, 'utf8').trim(), '0 0');
    const setupManifestPath = join(setupHome, 'Library', 'Application Support', 'Aloud', 'setup-manifest.json');
    const setupManifest = readFileSync(setupManifestPath, 'utf8');
    assert.deepEqual(JSON.parse(setupManifest), {
      modelRevision: 'f3ff3571791e39611d31c381e3a41a3af07b4987',
      pythonVersion: '3.12',
      schemaVersion: 1,
      status: 'complete',
    });
    const setupVenv = join(setupHome, 'Library', 'Application Support', 'Aloud', 'kokoro-venv');
    writeFileSync(join(setupVenv, 'previous-environment'), 'preserve on failed rebuild\n');
    const failedSetup = spawnSync('bash', ['scripts/setup-aloud.sh'], {
      cwd: fixture,
      encoding: 'utf8',
      env: {
        ...process.env,
        FAIL_PIP: '1',
        HOME: setupHome,
        PATH: `${fakeBin}:${process.env.PATH}`,
      },
    });
    assert.notEqual(failedSetup.status, 0);
    assert.equal(readFileSync(join(setupVenv, 'previous-environment'), 'utf8'), 'preserve on failed rebuild\n');
    assert.equal(readFileSync(setupManifestPath, 'utf8'), setupManifest);

    const unsafeBin = join(root, 'unsafe-home-bin');
    const unsafeMutationLog = join(root, 'unsafe-home-mutations.log');
    executable(join(unsafeBin, 'rm'), `#!/usr/bin/env bash\nprintf 'rm %s\\n' "$*" >> ${JSON.stringify(unsafeMutationLog)}\n`);
    executable(join(unsafeBin, 'launchctl'), `#!/usr/bin/env bash\nprintf 'launchctl %s\\n' "$*" >> ${JSON.stringify(unsafeMutationLog)}\n`);
    const unsafeUninstall = spawnSync('bash', [join(fixture, 'scripts', 'uninstall-macos-service.sh')], {
      cwd: fixture,
      encoding: 'utf8',
      env: { ...process.env, HOME: '', PATH: `${unsafeBin}:${process.env.PATH}` },
    });
    assert.notEqual(unsafeUninstall.status, 0);
    assert.match(unsafeUninstall.stderr, /unsafe HOME directory/);
    assert.ok(!existsSync(unsafeMutationLog), 'unsafe HOME must be rejected before launchctl or rm');

    const env = {
      ...process.env,
      HOME: home,
      NODE_LICENSE_FILE: nodeLicense,
      NODE_SOURCE: fakeNode,
      PATH: `${fakeBin}:${process.env.PATH}`,
    };
    mkdirSync(join(fixture, 'build', 'Aloud.app', 'Contents', 'Resources', 'app', 'dist'), { recursive: true });
    writeFileSync(join(fixture, 'build', 'Aloud.app', 'Contents', 'Resources', 'app', 'dist', 'stale.js'), 'stale');
    writeFileSync(join(fixture, 'build', 'Aloud.zip'), 'stale');

    run('bash', ['scripts/build-macos-app.sh'], { cwd: fixture, env });
    const app = join(fixture, 'build', 'Aloud.app');
    const zip = join(fixture, 'build', `Aloud-${version}-macos-${hostArch}.zip`);
    assert.ok(existsSync(app));
    assert.ok(existsSync(zip));
    assert.ok(existsSync(join(app, 'Contents', 'Resources', 'app', 'scripts', 'uninstall-macos-service.sh')));
    assert.ok(existsSync(join(app, 'Contents', 'Resources', 'app', 'requirements-kokoro-py312.lock.txt')));
    assert.ok(existsSync(join(app, 'Contents', 'Resources', 'app', 'requirements-pocket-py312.lock.txt')));
    assert.ok(existsSync(join(app, 'Contents', 'Resources', 'node', 'bin', 'node')));
    assert.ok(existsSync(join(app, 'Contents', 'Resources', 'node', 'LICENSE')));
    assert.ok(existsSync(join(app, 'Contents', 'Resources', 'app', 'native', 'AloudMenuBarCurrent')));
    assert.ok(existsSync(join(app, 'Contents', 'Resources', 'Aloud.icns')));
    const infoPlist = readFileSync(join(app, 'Contents', 'Info.plist'), 'utf8');
    assert.match(infoPlist, /<key>CFBundleIconFile<\/key>[\s\S]*<string>Aloud<\/string>/);
    assert.match(infoPlist, /<key>LSUIElement<\/key>\s*<true\/>/);
    const appLauncher = readFileSync(join(app, 'Contents', 'MacOS', 'Aloud'), 'utf8');
    assert.match(appLauncher, /choice="\$\{1:-activate\}"/);
    assert.match(appLauncher, /launchctl kickstart "gui\/\$\(id -u\)\/local\.aloud\.menubar"/);
    assert.doesNotMatch(appLauncher, /show_dialog/);
    assert.equal(readFileSync(join(app, 'Contents', 'Resources', 'runtime-architecture.txt'), 'utf8').trim(), hostArch);
    assert.ok(!existsSync(join(app, 'Contents', 'Resources', 'app', 'dist', 'stale.js')));
    assert.ok(!existsSync(join(fixture, 'build', 'Aloud.zip')));

    writeFileSync(join(fixture, 'build', 'Aloud.dmg'), 'stale');
    run('bash', ['scripts/build-macos-dmg.sh'], { cwd: fixture, env });
    const dmg = join(fixture, 'build', `Aloud-${version}-macos-${hostArch}.dmg`);
    assert.ok(existsSync(dmg));
    assert.ok(!existsSync(join(fixture, 'build', 'Aloud.dmg')));
    assert.ok(!existsSync(join(fixture, 'build', 'dmg-staging')));

    const packagedRoot = join(app, 'Contents', 'Resources', 'app');
    const packagedNode = join(app, 'Contents', 'Resources', 'node', 'bin', 'node');
    const installEnv = {
      ...env,
      HOME: home,
      ALOUD_NODE: packagedNode,
      ALOUD_DAEMON_PORT: String(daemonPort),
      ALOUD_SKIP_REGISTRATION: '1',
      ALOUD_TMP_ROOT: fakeTmp,
    };
    const unmanagedBeforeInstall = await startUnmanagedDaemon(legacyDaemonScript, daemonPort);
    childProcesses.push(unmanagedBeforeInstall);
    const unmanagedInstallExit = new Promise((resolve) => unmanagedBeforeInstall.once('exit', resolve));
    run('bash', [join(packagedRoot, 'scripts', 'install-macos-service.sh')], { cwd: fixture, env: installEnv });
    await unmanagedInstallExit;

    const unrelatedDaemonScript = join(root, 'unrelated-service', 'server.js');
    mkdirSync(dirname(unrelatedDaemonScript), { recursive: true });
    writeFileSync(unrelatedDaemonScript, `const http = require('node:http');
const server = http.createServer((_request, response) => { response.end('unrelated'); server.close(() => process.exit(9)); });
server.listen(Number(process.env.TEST_DAEMON_PORT), '127.0.0.1', () => console.log('ready'));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
`);
    const unrelatedDaemon = await startUnmanagedDaemon(unrelatedDaemonScript, daemonPort);
    childProcesses.push(unrelatedDaemon);
    const unrelatedStop = spawnSync('bash', [
      join(packagedRoot, 'scripts', 'stop-owned-daemon.sh'),
      packagedNode,
      join(packagedRoot, 'dist', 'cli.js'),
    ], { cwd: fixture, encoding: 'utf8', env: installEnv });
    assert.notEqual(unrelatedStop.status, 0);
    assert.match(unrelatedStop.stderr, /unverified listener/);
    assert.equal(unrelatedDaemon.exitCode, null, 'unrelated listener must not receive a shutdown request or signal');
    const unrelatedExit = new Promise((resolve) => unrelatedDaemon.once('exit', resolve));
    unrelatedDaemon.kill('SIGTERM');
    await unrelatedExit;

    const support = join(home, 'Library', 'Application Support', 'Aloud');
    const runtime = join(support, 'runtime', 'current');
    const daemonPlist = join(home, 'Library', 'LaunchAgents', 'local.aloud.daemon.plist');
    const workflow = join(home, 'Library', 'Services', 'Read Selection Aloud.workflow', 'Contents', 'document.wflow');
    assert.ok(existsSync(join(runtime, 'node', 'bin', 'node')));
    assert.ok(existsSync(join(runtime, 'dist', 'cli.js')));
    assert.match(readFileSync(daemonPlist, 'utf8'), /Application Support\/Aloud\/runtime\/current/);
    assert.doesNotMatch(readFileSync(daemonPlist, 'utf8'), /source from mounted image/);
    assert.match(readFileSync(workflow, 'utf8'), /Application Support\/Aloud\/runtime\/current/);
    assert.doesNotMatch(readFileSync(workflow, 'utf8'), /source from mounted image/);

    const stableFakeBin = join(root, 'stable-runtime-bin');
    executable(join(stableFakeBin, 'launchctl'), '#!/usr/bin/env bash\nexit 0\n');
    const stableRepairEnv = {
      ...installEnv,
      PATH: `${stableFakeBin}:/usr/bin:/bin:/usr/sbin:/sbin`,
    };
    delete stableRepairEnv.ALOUD_NODE;
    run('bash', [join(runtime, 'scripts', 'install-macos-service.sh')], { cwd: fixture, env: stableRepairEnv });

    const firstPayloadId = readFileSync(join(runtime, 'payload.sha256'), 'utf8').trim();
    writeFileSync(join(packagedRoot, 'dist', 'cli.js'), '// rebuilt same-version fixture\n');
    rmSync(join(packagedRoot, 'payload.sha256'));
    run('bash', [join(packagedRoot, 'scripts', 'install-macos-service.sh')], { cwd: fixture, env: installEnv });
    assert.equal(readFileSync(join(runtime, 'dist', 'cli.js'), 'utf8'), '// rebuilt same-version fixture\n');
    assert.notEqual(readFileSync(join(runtime, 'payload.sha256'), 'utf8').trim(), firstPayloadId);

    writeFileSync(join(support, 'keep-me.txt'), 'unrelated\n');
    const unrelatedService = join(home, 'Library', 'Services', 'Unrelated.workflow');
    mkdirSync(unrelatedService, { recursive: true });
    writeFileSync(join(unrelatedService, 'sentinel'), 'keep\n');
    const unrelatedAgent = join(home, 'Library', 'LaunchAgents', 'unrelated.plist');
    writeFileSync(unrelatedAgent, 'keep\n');

    const unmanagedBeforeUninstall = await startUnmanagedDaemon(legacyDaemonScript, daemonPort);
    childProcesses.push(unmanagedBeforeUninstall);
    const unmanagedUninstallExit = new Promise((resolve) => unmanagedBeforeUninstall.once('exit', resolve));
    run('bash', [join(packagedRoot, 'scripts', 'uninstall-macos-service.sh')], { cwd: fixture, env: installEnv });
    await unmanagedUninstallExit;
    assert.ok(!existsSync(join(home, 'Library', 'LaunchAgents', 'local.aloud.daemon.plist')));
    assert.ok(!existsSync(join(home, 'Library', 'Services', 'Read Selection Aloud.workflow')));
    assert.ok(!existsSync(join(support, 'runtime')));
    assert.ok(existsSync(join(support, 'keep-me.txt')));
    assert.ok(existsSync(join(unrelatedService, 'sentinel')));
    assert.ok(existsSync(unrelatedAgent));

    symlinkSync('/tmp', join(fixture, 'build', 'symlink-sentinel'));
    run('bash', ['scripts/clean.sh'], { cwd: fixture, env });
    assert.ok(!existsSync(join(fixture, 'dist')));
    assert.ok(!existsSync(join(fixture, 'build')));
  } finally {
    for (const child of childProcesses) {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
    rmSync(root, { force: true, recursive: true });
  }
});
