import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createVoiceExportManager } from '../dist/voice-export.js';

test('long voice exports synthesize bounded parts and stitch their PCM into one WAV', async () => {
  const home = mkdtempSync(join(tmpdir(), 'aloud-export-'));
  const sourceDir = join(home, 'source-audio');
  mkdirSync(sourceDir, { recursive: true });
  const calls = [];
  const manager = createVoiceExportManager(home, async (_home, input) => {
    const index = calls.length;
    calls.push(input);
    const path = join(sourceDir, `${index}.wav`);
    writeFileSync(path, pcmWav(Buffer.alloc(480, index + 1)));
    return {
      cached: false,
      dir: sourceDir,
      id: String(index).padStart(64, '0'),
      langCode: 'a',
      path,
      rate: input.rate,
      url: `/source/${index}.wav`,
      voice: input.voice,
    };
  });

  try {
    const text = Array.from({ length: 900 }, (_, index) => `Sentence ${index + 1} has enough detail for a long narrated document.`).join(' ');
    const started = manager.start({ filename: 'Long chapter', rate: 1.25, text, voice: 'af_heart' });
    const ready = await waitForExport(manager, started.id, 'ready');

    assert.ok(calls.length >= 10, `expected many bounded parts, got ${calls.length}`);
    assert.ok(calls.every((call) => call.text.length <= 3500));
    assert.equal(calls.map((call) => call.text).join(' '), text);
    assert.ok(calls.every((call) => call.voice === 'af_heart' && call.rate === 1.25));
    assert.equal(ready.current, calls.length);
    assert.equal(ready.total, calls.length);
    assert.equal(ready.progress, 100);
    assert.equal(ready.filename, 'Long chapter.wav');
    assert.equal(ready.downloadUrl, `/api/exports/${started.id}/file`);

    const file = manager.file(started.id);
    assert.ok(file);
    const wav = readFileSync(file.path);
    assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
    assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
    assert.equal(wav.toString('ascii', 36, 40), 'data');
    assert.equal(wav.readUInt32LE(40), calls.length * 480);
    assert.equal(wav.length, 44 + calls.length * 480);
    for (let index = 0; index < calls.length; index += 1) {
      assert.equal(wav[44 + index * 480], index + 1);
    }
  } finally {
    manager.dispose();
    rmSync(home, { force: true, recursive: true });
  }
});

test('an active voice export can be cancelled without publishing a partial file', async () => {
  const home = mkdtempSync(join(tmpdir(), 'aloud-export-cancel-'));
  const manager = createVoiceExportManager(home, async (_home, _input, options) => {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, 10_000);
      options.signal.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new Error('cancelled'));
      }, { once: true });
    });
    throw new Error('must not finish');
  });

  try {
    const started = manager.start({ text: 'A voice file that will be cancelled.', voice: 'af_heart' });
    const cancelled = manager.cancel(started.id);
    assert.equal(cancelled.state, 'cancelled');
    const settled = await waitForExport(manager, started.id, 'cancelled');
    assert.equal(settled.message, 'Voice file export cancelled.');
    assert.equal(manager.file(started.id), undefined);
  } finally {
    manager.dispose();
    rmSync(home, { force: true, recursive: true });
  }
});

test('Pocket voice exports report their native 1x WAV speed', async () => {
  const home = mkdtempSync(join(tmpdir(), 'aloud-export-pocket-'));
  const sourceDir = join(home, 'source-audio');
  mkdirSync(sourceDir, { recursive: true });
  const calls = [];
  const manager = createVoiceExportManager(home, async (_home, input) => {
    calls.push(input);
    const path = join(sourceDir, `${calls.length}.wav`);
    writeFileSync(path, pcmWav(Buffer.alloc(48, calls.length)));
    return {
      cached: false,
      engine: 'pocket',
      id: String(calls.length).padStart(64, '0'),
      path,
      rate: input.rate,
      url: `/source/${calls.length}.wav`,
      voice: input.voice,
    };
  });

  try {
    const started = manager.start({ engine: 'pocket', rate: 1.5, text: 'Pocket export.', voice: 'alba' });
    const ready = await waitForExport(manager, started.id, 'ready');
    assert.equal(ready.rate, 1);
    assert.ok(calls.every((call) => call.rate === 1));
  } finally {
    manager.dispose();
    rmSync(home, { force: true, recursive: true });
  }
});

async function waitForExport(manager, id, state) {
  for (let index = 0; index < 200; index += 1) {
    const status = manager.get(id);
    if (status?.state === state) return status;
    if (status && ['error', 'cancelled'].includes(status.state)) {
      assert.fail(`export stopped in ${status.state}: ${status.error || status.message}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(`export did not reach ${state}`);
}

function pcmWav(data) {
  const wav = Buffer.alloc(44 + data.length);
  wav.write('RIFF', 0, 'ascii');
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVE', 8, 'ascii');
  wav.write('fmt ', 12, 'ascii');
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(24_000, 24);
  wav.writeUInt32LE(48_000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36, 'ascii');
  wav.writeUInt32LE(data.length, 40);
  data.copy(wav, 44);
  return wav;
}
