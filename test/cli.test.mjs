import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/cli.ts', import.meta.url), 'utf8');

test('daemon speak calls only send menu-controlled settings when the user passed explicit flags', () => {
  assert.match(source, /mode: args\.modeExplicit \? args\.mode : undefined/);
  assert.match(source, /rate: args\.rateExplicit \? args\.rate : undefined/);
  assert.match(source, /voice: args\.voiceExplicit \? args\.voice : undefined/);
});

test('CLI exposes a scoped daemon shutdown command', () => {
  assert.match(source, /argv\[0\] === 'shutdown-daemon'/);
  assert.match(source, /await shutdownSpeechDaemon\(\)/);
  assert.match(source, /controllerCloseDelay = 3600/);
  assert.match(source, /controllerCloseDelay = 6000/);
});
