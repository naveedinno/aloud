import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
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
  const home = mkdtempSync(join(tmpdir(), 'kokoro-reader-preferences-'));
  try {
    saveReaderPreferences(home, {
      mode: 'smooth',
      rate: 1.25,
      shortcut: 'option+space',
      voice: 'bm_daniel',
    });
    assert.deepEqual(loadReaderPreferences(home), {
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
  const home = mkdtempSync(join(tmpdir(), 'kokoro-reader-health-'));
  try {
    const venv = join(home, 'Library', 'Application Support', 'Kokoro Reader', 'kokoro-venv');
    mkdirSync(join(venv, 'bin'), { recursive: true });
    mkdirSync(join(venv, 'lib', 'python3.12', 'site-packages', 'kokoro'), { recursive: true });
    mkdirSync(join(home, 'Library', 'Services', 'Read Aloud with Kokoro.workflow'), { recursive: true });
    mkdirSync(join(home, 'Library', 'Services', 'Stop Kokoro Reader.workflow'), { recursive: true });
    mkdirSync(join(home, 'Library', 'LaunchAgents'), { recursive: true });
    mkdirSync(join(home, 'Library', 'Application Support', 'Kokoro Reader', 'menubar'), { recursive: true });
    writeFileSync(join(home, 'Library', 'Application Support', 'Kokoro Reader', 'menubar', 'KokoroReaderMenuBar'), 'binary');
    writeFileSync(join(home, 'Library', 'LaunchAgents', 'local.kokoro-reader.menubar.plist'), 'plist');
    writeFileSync(join(venv, 'bin', 'python'), 'python');
    assert.equal(kokoroEnvironmentReady(home), true);
    const health = readerSystemHealth({
      accessibilityTrusted: true,
      canGoNext: false,
      canGoPrevious: false,
      canReplay: false,
      mode: 'auto',
      modeLabel: 'Auto',
      ok: true,
      paused: false,
      rate: 1,
      running: false,
      shortcut: 'option+r',
      shortcutLabel: 'Option + R',
      state: { status: 'done' },
      voice: 'af_heart',
      voiceLabel: 'Heart',
    }, home);
    assert.equal(health.kokoro.state, 'ready');
    assert.equal(health.services.state, 'ready');
    assert.equal(health.menuBar.state, 'ready');
    assert.equal(health.accessibility.state, 'ready');
  } finally {
    rmSync(home, { force: true, recursive: true });
  }
});
