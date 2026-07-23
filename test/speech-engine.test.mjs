import assert from 'node:assert/strict';
import test from 'node:test';
import { recommendedKokoroWorkers } from '../dist/speech-engine.js';

const gib = 1024 ** 3;

test('speech engine uses a second prefetch worker only on capable Macs', () => {
  assert.equal(recommendedKokoroWorkers(8 * gib, 12), 1);
  assert.equal(recommendedKokoroWorkers(24 * gib, 4), 1);
  assert.equal(recommendedKokoroWorkers(16 * gib, 8), 2);
  assert.equal(recommendedKokoroWorkers(24 * gib, 12), 2);
});
