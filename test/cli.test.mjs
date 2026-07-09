import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/cli.ts', import.meta.url), 'utf8');

test('daemon speak calls only send menu-controlled settings when the user passed explicit flags', () => {
  assert.match(source, /mode: args\.modeExplicit \? args\.mode : undefined/);
  assert.match(source, /rate: args\.rateExplicit \? args\.rate : undefined/);
  assert.match(source, /voice: args\.voiceExplicit \? args\.voice : undefined/);
});
