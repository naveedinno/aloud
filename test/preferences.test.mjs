import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import test from 'node:test';
import {
  globalShortcutLabel,
  loadReaderPreferences,
  normalizeGlobalShortcut,
  saveReaderPreferences,
} from '../dist/preferences.js';
import { kokoroEnvironmentReady, readerSystemHealth } from '../dist/system-health.js';

test('reader preferences persist shared voice, mode, rate, and shortcut', () => {
  const home = mkdtempSync(join(tmpdir(), 'aloud-preferences-'));
  try {
    saveReaderPreferences(home, {
      engine: 'pocket',
      mode: 'smooth',
      rate: 1.25,
      shortcut: 'option+space',
      voice: 'bm_daniel',
    });
    assert.deepEqual(loadReaderPreferences(home), {
      engine: 'pocket',
      mode: 'smooth',
      rate: 1.25,
      shortcut: 'option+space',
      voice: 'bm_daniel',
    });
  } finally {
    rmSync(home, { force: true, recursive: true });
  }
});

test('global shortcut choices reject unsupported combinations', () => {
  assert.equal(normalizeGlobalShortcut('control+option+r'), 'control+option+r');
  assert.equal(globalShortcutLabel('command+shift+r'), 'Command + Shift + R');
  assert.equal(normalizeGlobalShortcut('command+delete'), 'option+r');
});

test('system health recognizes a complete local Kokoro environment', () => {
  const home = mkdtempSync(join(tmpdir(), 'aloud-health-'));
  try {
    const venv = join(home, 'Library', 'Application Support', 'Aloud', 'kokoro-venv');
    mkdirSync(join(venv, 'bin'), { recursive: true });
    mkdirSync(join(venv, 'lib', 'python3.12', 'site-packages', 'kokoro'), { recursive: true });
    mkdirSync(join(venv, 'lib', 'python3.12', 'site-packages', 'pocket_tts'), { recursive: true });
    mkdirSync(join(home, 'Library', 'Services', 'Read Selection Aloud.workflow'), { recursive: true });
    mkdirSync(join(home, 'Library', 'Services', 'Stop Aloud.workflow'), { recursive: true });
    mkdirSync(join(home, 'Library', 'LaunchAgents'), { recursive: true });
    mkdirSync(join(home, 'Library', 'Application Support', 'Aloud', 'menubar'), { recursive: true });
    writeFileSync(join(home, 'Library', 'Application Support', 'Aloud', 'menubar', 'AloudMenuBarCurrent'), 'binary');
    writeFileSync(join(home, 'Library', 'LaunchAgents', 'local.aloud.menubar.plist'), 'plist');
    writeFileSync(join(venv, 'bin', 'python'), 'python');
    chmodSync(join(home, 'Library', 'Application Support', 'Aloud', 'menubar', 'AloudMenuBarCurrent'), 0o755);
    chmodSync(join(venv, 'bin', 'python'), 0o755);
    assert.equal(kokoroEnvironmentReady(home), false, 'a partial venv without the setup manifest must not report ready');

    const modelRevision = 'f3ff3571791e39611d31c381e3a41a3af07b4987';
    const requiredModelFiles = [
      'config.json',
      'kokoro-v1_0.pth',
      'voices/af_heart.pt',
      'voices/af_bella.pt',
      'voices/af_nicole.pt',
      'voices/af_sarah.pt',
      'voices/am_adam.pt',
      'voices/am_onyx.pt',
      'voices/bf_emma.pt',
      'voices/bm_daniel.pt',
    ];
    const appSupport = join(home, 'Library', 'Application Support', 'Aloud');
    const modelSnapshot = join(appSupport, 'huggingface', 'hub', 'models--hexgrad--Kokoro-82M', 'snapshots', modelRevision);
    for (const relativePath of requiredModelFiles) {
      const path = join(modelSnapshot, relativePath);
      mkdirSync(join(path, '..'), { recursive: true });
      writeFileSync(path, 'model');
    }
    const requirementsLock = readFileSync(new URL('../requirements-kokoro-py312.lock.txt', import.meta.url));
    const pocketRequirementsLock = readFileSync(new URL('../requirements-pocket-py312.lock.txt', import.meta.url));
    writeFileSync(join(appSupport, 'setup-manifest.json'), JSON.stringify({
      schemaVersion: 2,
      status: 'complete',
      pythonVersion: '3.12',
      requirementsLockSha256: createHash('sha256').update(requirementsLock).digest('hex'),
      pocketRequirementsLockSha256: createHash('sha256').update(pocketRequirementsLock).digest('hex'),
      pocketTtsVersion: '2.1.0',
      modelRepository: 'hexgrad/Kokoro-82M',
      modelRevision,
      requiredModelFiles,
    }));
    assert.equal(kokoroEnvironmentReady(home), false, 'the offline model ref is part of a usable setup');
    const modelRef = join(appSupport, 'huggingface', 'hub', 'models--hexgrad--Kokoro-82M', 'refs', 'main');
    mkdirSync(join(modelRef, '..'), { recursive: true });
    writeFileSync(modelRef, 'wrong-revision\n');
    assert.equal(kokoroEnvironmentReady(home), false, 'a stale offline model ref must not report ready');
    writeFileSync(modelRef, `${modelRevision}\n`);
    assert.equal(kokoroEnvironmentReady(home), false, 'a newline-corrupted model ref must not report ready');
    writeFileSync(modelRef, modelRevision);
    assert.equal(kokoroEnvironmentReady(home), true);
    const health = readerSystemHealth({
      accessibilityTrusted: true,
      canGoNext: false,
      canGoPrevious: false,
      canReplay: false,
      engine: 'kokoro',
      engineLabel: 'Kokoro',
      mode: 'auto',
      modeLabel: 'Auto',
      ok: true,
      paused: false,
      rate: 1,
      running: false,
      shortcut: 'option+r',
      shortcutLabel: 'Option + R',
      service: 'aloud-speech-daemon',
      protocolVersion: 2,
      state: { status: 'done' },
      voice: 'af_heart',
      voiceLabel: 'Heart',
    }, home, { launchAgentLoaded: () => true });
    assert.equal(health.kokoro.state, 'ready');
    assert.equal(health.services.state, 'ready');
    assert.equal(health.menuBar.state, 'ready');
    assert.equal(health.accessibility.state, 'ready');
  } finally {
    rmSync(home, { force: true, recursive: true });
  }
});
