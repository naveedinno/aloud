import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  createManagedKokoroSynthesizer,
  isKokoroTtsId,
  kokoroRate,
  kokoroTtsCachePath,
  kokoroTtsUrl,
  kokoroVoiceLabel,
  kokoroWorkerCount,
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

test('Kokoro defaults to one model worker and bounds explicit overrides', () => {
  assert.equal(kokoroWorkerCount(), 1);
  assert.equal(kokoroWorkerCount(0), 1);
  assert.equal(kokoroWorkerCount(2), 2);
  assert.equal(kokoroWorkerCount(99), 4);
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

test('managed Kokoro synthesizer is lazy, reuses a warm session, and unloads it after idle', async () => {
  const home = mkdtempSync(join(tmpdir(), 'kokoro-reader-managed-home-'));
  let created = 0;
  let disposed = 0;
  const manager = createManagedKokoroSynthesizer(home, {
    idleMs: 15,
    createSession: () => {
      created += 1;
      return {
        async synthesize(input) {
          return {
            cached: false,
            ...kokoroTtsCachePath(home, input),
            url: '/api/tts/kokoro/test.wav',
          };
        },
        dispose() {
          disposed += 1;
        },
      };
    },
  });
  try {
    assert.equal(created, 0);
    await manager.synthesize({ text: 'one' });
    await manager.synthesize({ text: 'two' });
    assert.equal(created, 1);
    assert.equal(disposed, 0);
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(disposed, 1);
    await manager.synthesize({ text: 'three' });
    assert.equal(created, 2);
  } finally {
    manager.dispose();
    rmSync(home, { recursive: true, force: true });
  }
  assert.equal(disposed, 2);
});

test('Kokoro worker uses inference mode and shares one model across language pipelines', () => {
  const source = readFileSync(new URL('../src/kokoro-tts.ts', import.meta.url), 'utf8');
  assert.match(source, /with torch\.inference_mode\(\):/);
  assert.match(source, /shared_model = None/);
  assert.match(source, /model=shared_model if shared_model is not None else True/);
});
