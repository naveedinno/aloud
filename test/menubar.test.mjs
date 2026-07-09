import assert from 'node:assert/strict';
import test from 'node:test';
import {
  nativeMenuBarPaths,
  nativeMenuBarSource,
} from '../dist/menubar.js';

test('native menu bar helper exposes the expected controls', () => {
  const source = nativeMenuBarSource();
  assert.match(source, /NSStatusBar\.system\.statusItem/);
  assert.match(source, /NSStatusItem\.squareLength/);
  assert.match(source, /enum MenuBarVisualState/);
  assert.match(source, /menuBarIcon\(state: MenuBarVisualState\)/);
  assert.match(source, /NSBezierPath/);
  assert.match(source, /appendArc/);
  assert.doesNotMatch(source, /NSImage\(systemSymbolName:/);
  assert.doesNotMatch(source, /speaker\.wave/);
  assert.match(source, /button\.title = ""/);
  assert.doesNotMatch(source, /button\.title = "Kokoro"/);
  assert.match(source, /case \.generating:/);
  assert.match(source, /case \.reading:/);
  assert.match(source, /image\.isTemplate = state == \.idle/);
  assert.match(source, /menu\.autoenablesItems = false/);
  assert.match(source, /readerMenu\.autoenablesItems = false/);
  assert.match(source, /modeMenu\.autoenablesItems = false/);
  assert.match(source, /speedMenu\.autoenablesItems = false/);
  assert.match(source, /Stop Reading/);
  assert.match(source, /Pause Reading/);
  assert.match(source, /Resume Reading/);
  assert.match(source, /Read Selection/);
  assert.match(source, /Read Clipboard/);
  assert.match(source, /Reader/);
  assert.match(source, /Random/);
  assert.match(source, /Heart/);
  assert.match(source, /Daniel/);
  assert.match(source, /Mode/);
  assert.match(source, /Auto/);
  assert.match(source, /Fast Start/);
  assert.match(source, /Smooth Playback/);
  assert.match(source, /Speed/);
  assert.match(source, /Slow 0\.8x/);
  assert.match(source, /Normal 1x/);
  assert.match(source, /Fast 1\.25x/);
  assert.match(source, /Open Reader/);
  assert.match(source, /Install Services/);
  assert.match(source, /Quit Menu Bar/);
});

test('native menu bar helper talks to the warm daemon', () => {
  const source = nativeMenuBarSource();
  assert.match(source, /http:\/\/127\.0\.0\.1:17878/);
  assert.match(source, /request\(path: "status", method: "GET"/);
  assert.match(source, /request\(path: "stop", method: "POST"/);
  assert.match(source, /request\(path: isPaused \? "resume" : "pause", method: "POST"/);
  assert.match(source, /request\(path: "speak", method: "POST"/);
  assert.match(source, /request\(path: "mode", method: "POST"/);
  assert.match(source, /request\(path: "rate", method: "POST"/);
  assert.match(source, /request\(path: "voice", method: "POST"/);
});

test('native menu bar helper registers a global read-selection hotkey', () => {
  const source = nativeMenuBarSource();
  assert.match(source, /import Carbon\.HIToolbox/);
  assert.match(source, /RegisterEventHotKey/);
  assert.match(source, /kVK_ANSI_R/);
  assert.match(source, /optionKey/);
  assert.match(source, /handleGlobalHotKey/);
  assert.match(source, /readSelection/);
  assert.match(source, /captureClipboard/);
  assert.match(source, /restoreClipboard/);
  assert.match(source, /postCopyShortcut/);
});

test('native menu bar helper reads clipboard text through the daemon', () => {
  const source = nativeMenuBarSource();
  assert.match(source, /NSPasteboard\.general\.string\(forType: \.string\)/);
  assert.match(source, /speakPayload\(text: text\)/);
  assert.match(source, /"text": text/);
  assert.match(source, /"mode": currentMode/);
  assert.match(source, /"rate": currentRate/);
  assert.match(source, /"voice": currentVoice/);
  assert.match(source, /Clipboard has no readable text\./);
});

test('native menu bar helper is stored under Kokoro Reader support files', () => {
  const paths = nativeMenuBarPaths('/tmp/kokoro-home');
  assert.equal(paths.executable, '/tmp/kokoro-home/Library/Application Support/Kokoro Reader/menubar/KokoroReaderMenuBar');
  assert.equal(paths.source, '/tmp/kokoro-home/Library/Application Support/Kokoro Reader/menubar/KokoroReaderMenuBar.swift');
});
