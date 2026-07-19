import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  clearKokoroTtsCache,
  createKokoroSynthesizerSession,
  createManagedKokoroSynthesizer,
  isValidKokoroCacheFile,
  isKokoroTtsId,
  kokoroTtsCacheDir,
  kokoroRate,
  kokoroTtsCachePath,
  kokoroTtsUrl,
  kokoroVoiceLabel,
  kokoroWorkerCount,
  normalizeKokoroText,
  normalizeKokoroVoice,
  pruneKokoroTtsCache,
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
  const home = mkdtempSync(join(tmpdir(), 'aloud-home-'));
  try {
    const a = kokoroTtsCachePath(home, { text: 'hello', voice: 'heart', rate: 1 });
    const b = kokoroTtsCachePath(home, { text: 'hello', voice: 'af_heart', rate: 1 });
    const c = kokoroTtsCachePath(home, { text: 'hello again', voice: 'af_heart', rate: 1 });
    assert.equal(a.id, b.id);
    assert.notEqual(a.id, c.id);
    assert.ok(a.path.startsWith(join(home, 'Library', 'Application Support', 'Aloud', 'tts-cache', 'kokoro')));
    assert.equal(kokoroTtsUrl(a.id), `/api/tts/kokoro/${a.id}.wav`);
    assert.equal(isKokoroTtsId(a.id), true);
    assert.equal(isKokoroTtsId('not-real'), false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('managed Kokoro synthesizer is lazy, reuses a warm session, and unloads it after idle', async () => {
  const home = mkdtempSync(join(tmpdir(), 'aloud-managed-home-'));
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

test('Kokoro session deduplicates generation and atomically publishes private valid WAV files', async () => {
  const home = mkdtempSync(join(tmpdir(), 'aloud-session-home-'));
  const counter = join(home, 'worker-count.txt');
  const worker = fakeWorker(home, counter, 15);
  const session = createKokoroSynthesizerSession(home, { command: worker, timeoutMs: 5000 });
  try {
    const [first, duplicate] = await Promise.all([
      session.synthesize({ text: 'deduplicate me' }),
      session.synthesize({ text: 'deduplicate me' }),
    ]);
    assert.equal(first.path, duplicate.path);
    assert.equal(readFileSync(counter, 'utf8').trim().split('\n').length, 1);
    assert.equal(isValidKokoroCacheFile(first.path), true);
    assert.equal(statSync(first.path).mode & 0o777, 0o600);
    assert.equal(statSync(kokoroTtsCacheDir(home)).mode & 0o777, 0o700);
    assert.equal(readdirSync(kokoroTtsCacheDir(home)).some((name) => name.endsWith('.tmp.wav')), false);
    assert.equal((await session.synthesize({ text: 'deduplicate me' })).cached, true);
  } finally {
    session.dispose();
    rmSync(home, { recursive: true, force: true });
  }
});

test('Kokoro worker queue rejects overload with 429 and times out stuck work', async () => {
  const home = mkdtempSync(join(tmpdir(), 'aloud-queue-home-'));
  const worker = fakeWorker(home, join(home, 'worker-count.txt'), 80);
  const session = createKokoroSynthesizerSession(home, {
    command: worker,
    maxQueuePerWorker: 1,
    timeoutMs: 5000,
  });
  try {
    const first = session.synthesize({ text: 'first request' });
    await new Promise((resolve) => setTimeout(resolve, 10));
    await assert.rejects(
      session.synthesize({ text: 'second request' }),
      (err) => err.statusCode === 429,
    );
    await first;
  } finally {
    session.dispose();
  }

  const stuck = fakeWorker(home, join(home, 'stuck-count.txt'), -1);
  const timeoutSession = createKokoroSynthesizerSession(home, { command: stuck, timeoutMs: 20 });
  try {
    await assert.rejects(
      timeoutSession.synthesize({ text: 'never finishes' }),
      (err) => err.statusCode === 504,
    );
  } finally {
    timeoutSession.dispose();
    rmSync(home, { recursive: true, force: true });
  }
});

test('cache pruning removes invalid and abandoned temp files and clear removes recent audio', () => {
  const home = mkdtempSync(join(tmpdir(), 'aloud-prune-home-'));
  try {
    const dir = kokoroTtsCacheDir(home);
    mkdirSync(dir, { recursive: true });
    const valid = join(dir, `${'a'.repeat(64)}.wav`);
    const invalid = join(dir, `${'b'.repeat(64)}.wav`);
    const staleTemp = `${valid}.old.tmp.wav`;
    writeFileSync(valid, wavBytes(80));
    writeFileSync(invalid, Buffer.from('broken'));
    writeFileSync(staleTemp, wavBytes(64));
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
    utimesSync(staleTemp, old, old);

    const pruned = pruneKokoroTtsCache(home);
    assert.ok(pruned.removedFiles >= 2);
    assert.equal(existsSync(invalid), false);
    assert.equal(existsSync(staleTemp), false);
    assert.equal(existsSync(valid), true);

    const cleared = clearKokoroTtsCache(home);
    assert.equal(cleared.removedFiles, 1);
    assert.equal(existsSync(valid), false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('Kokoro worker uses inference mode and shares one model across language pipelines', () => {
  const source = readFileSync(new URL('../src/kokoro-tts.ts', import.meta.url), 'utf8');
  assert.match(source, /with torch\.inference_mode\(\):/);
  assert.match(source, /shared_model = None/);
  assert.match(source, /model=shared_model if shared_model is not None else True/);
});

function fakeWorker(home, counter, delayMs) {
  const path = join(home, `fake-kokoro-worker-${Math.abs(delayMs)}.cjs`);
  const source = `#!/usr/bin/env node
const fs = require('node:fs');
const readline = require('node:readline');
const delay = ${delayMs};
const counter = ${JSON.stringify(counter)};
const input = readline.createInterface({ input: process.stdin });
input.on('line', (line) => {
  const request = JSON.parse(line);
  fs.appendFileSync(counter, String(request.id) + '\\n');
  if (delay < 0) return;
  setTimeout(() => {
    const wav = Buffer.alloc(64);
    wav.write('RIFF', 0, 'ascii');
    wav.writeUInt32LE(wav.length - 8, 4);
    wav.write('WAVE', 8, 'ascii');
    fs.writeFileSync(request.out_path, wav, { mode: 0o600 });
    process.stdout.write(JSON.stringify({ id: request.id, ok: true }) + '\\n');
  }, delay);
});
`;
  writeFileSync(path, source, { mode: 0o700 });
  chmodSync(path, 0o700);
  return path;
}

function wavBytes(size = 64) {
  const buffer = Buffer.alloc(Math.max(44, size));
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write('WAVE', 8, 'ascii');
  return buffer;
}
