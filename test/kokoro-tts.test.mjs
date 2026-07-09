import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  isKokoroTtsId,
  kokoroRate,
  kokoroTtsCachePath,
  kokoroTtsUrl,
  kokoroVoiceLabel,
  normalizeKokoroText,
  normalizeKokoroVoice,
} from '../dist/kokoro-tts.js';

test('kokoro voice aliases normalize to supported voices', () => {
  assert.equal(normalizeKokoroVoice('heart'), 'af_heart');
  assert.equal(normalizeKokoroVoice('Bella'), 'af_bella');
  assert.equal(normalizeKokoroVoice('onyx'), 'am_onyx');
  assert.equal(normalizeKokoroVoice('Daniel'), 'bm_daniel');
  assert.equal(normalizeKokoroVoice('unknown'), 'af_heart');
  assert.equal(kokoroVoiceLabel('bm_daniel'), 'Daniel');
});

test('kokoro rate is clamped to the safe local range', () => {
  assert.equal(kokoroRate(0.1), 0.6);
  assert.equal(kokoroRate(1), 1);
  assert.equal(kokoroRate(3), 1.5);
  assert.equal(kokoroRate(Number.NaN), 1);
});

test('kokoro text normalization preserves paragraph breaks and trims noise', () => {
  assert.equal(normalizeKokoroText(' hello   there\\n\\n second   line '), 'hello there\\n\\n second line');
});

test('kokoro cache path and URL are deterministic', () => {
  const home = mkdtempSync(join(tmpdir(), 'kokoro-reader-home-'));
  try {
    const a = kokoroTtsCachePath(home, { text: 'hello', voice: 'heart', rate: 1 });
    const b = kokoroTtsCachePath(home, { text: 'hello', voice: 'af_heart', rate: 1 });
    const c = kokoroTtsCachePath(home, { text: 'hello again', voice: 'af_heart', rate: 1 });
    assert.equal(a.id, b.id);
    assert.notEqual(a.id, c.id);
    assert.ok(a.path.startsWith(join(home, 'Library', 'Application Support', 'Kokoro Reader', 'tts-cache', 'kokoro')));
    assert.equal(kokoroTtsUrl(a.id), `/api/tts/kokoro/${a.id}.wav`);
    assert.equal(isKokoroTtsId(a.id), true);
    assert.equal(isKokoroTtsId('not-real'), false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
