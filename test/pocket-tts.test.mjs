import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  createManagedPocketSynthesizer,
  normalizePocketVoice,
  pocketVoiceOptions,
} from '../dist/pocket-tts.js';
import {
  engineVoiceOptions,
  normalizeEngineVoice,
  normalizeSpeechEngine,
} from '../dist/speech-engine.js';

test('Pocket TTS exposes its own normalized voice catalog', () => {
  assert.equal(normalizeSpeechEngine('pocket'), 'pocket');
  assert.equal(normalizeSpeechEngine('unknown'), 'kokoro');
  assert.equal(normalizePocketVoice('Peter Yearsley'), 'peter_yearsley');
  assert.equal(normalizeEngineVoice('pocket', 'not-a-voice'), 'alba');
  assert.ok(pocketVoiceOptions().length >= 20);
  assert.ok(engineVoiceOptions('pocket').some((voice) => voice.id === 'marius'));
});

test('managed Pocket TTS synthesis writes and reuses private WAV cache entries', async () => {
  const home = mkdtempSync(join(tmpdir(), 'aloud-pocket-'));
  const worker = join(home, 'fake-pocket-worker');
  writeFileSync(worker, `#!/usr/bin/env node
const fs = require('node:fs');
const readline = require('node:readline');
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const request = JSON.parse(line);
  const wav = Buffer.alloc(46);
  wav.write('RIFF', 0, 'ascii');
  wav.writeUInt32LE(38, 4);
  wav.write('WAVEfmt ', 8, 'ascii');
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(24000, 24);
  wav.writeUInt32LE(48000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36, 'ascii');
  wav.writeUInt32LE(2, 40);
  fs.writeFileSync(request.out_path, wav);
  process.stdout.write(JSON.stringify({ id: request.id, ok: true }) + '\\n');
});
`, { mode: 0o700 });
  chmodSync(worker, 0o700);
  const synthesizer = createManagedPocketSynthesizer(home, { command: worker, idleMs: 5 });
  try {
    const first = await synthesizer.synthesize({ text: 'Pocket cache test.', voice: 'Alba' });
    const second = await synthesizer.synthesize({ text: 'Pocket cache test.', voice: 'Alba' });
    assert.equal(first.cached, false);
    assert.equal(second.cached, true);
    assert.equal(first.voice, 'alba');
    assert.match(first.url, /^\/api\/tts\/pocket\/[a-f0-9]{64}\.wav$/);
    assert.equal(first.path, second.path);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const afterIdle = await synthesizer.synthesize({ text: 'Pocket worker restarted.', voice: 'Anna' });
    assert.equal(afterIdle.cached, false);
    assert.equal(afterIdle.voice, 'anna');
  } finally {
    synthesizer.dispose();
    rmSync(home, { force: true, recursive: true });
  }
});

test('a closing Pocket worker cannot reject work owned by its replacement', async () => {
  const home = mkdtempSync(join(tmpdir(), 'aloud-pocket-restart-'));
  const worker = join(home, 'fake-pocket-worker');
  writeFileSync(worker, `#!/usr/bin/env node
const fs = require('node:fs');
const readline = require('node:readline');
const rl = readline.createInterface({ input: process.stdin });
process.on('SIGTERM', () => {
  setTimeout(() => {
    process.removeAllListeners('SIGTERM');
    process.kill(process.pid, 'SIGTERM');
  }, 80);
});
rl.on('line', (line) => {
  const request = JSON.parse(line);
  setTimeout(() => {
    const wav = Buffer.alloc(46);
    wav.write('RIFF', 0, 'ascii');
    wav.writeUInt32LE(38, 4);
    wav.write('WAVEfmt ', 8, 'ascii');
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(24000, 24);
    wav.writeUInt32LE(48000, 28);
    wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34);
    wav.write('data', 36, 'ascii');
    wav.writeUInt32LE(2, 40);
    fs.writeFileSync(request.out_path, wav);
    process.stdout.write(JSON.stringify({ id: request.id, ok: true }) + '\\n');
  }, 180);
});
`, { mode: 0o700 });
  chmodSync(worker, 0o700);
  const synthesizer = createManagedPocketSynthesizer(home, { command: worker, idleMs: 5_000 });
  try {
    const abort = new AbortController();
    const cancelled = synthesizer.synthesize({ text: 'Cancel the first worker.', voice: 'Alba' }, { signal: abort.signal });
    await new Promise((resolve) => setTimeout(resolve, 120));
    abort.abort();
    await assert.rejects(cancelled, { name: 'AbortError' });

    const replacement = await synthesizer.synthesize({ text: 'The replacement must survive.', voice: 'Anna' });
    assert.equal(replacement.cached, false);
    assert.equal(replacement.voice, 'anna');
  } finally {
    synthesizer.dispose();
    rmSync(home, { force: true, recursive: true });
  }
});
