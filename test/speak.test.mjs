import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  audioPlayerCommand,
  parseSpeakArgs,
  speechBatchesForMode,
  splitTextIntoSpeechBatches,
  speakText,
} from '../dist/speak.js';

test('speak args default to stdin with browser disabled', () => {
  assert.deepEqual(parseSpeakArgs(['speak']), {
    batch: true,
    controller: false,
    daemon: false,
    help: false,
    mode: 'fast-start',
    modeExplicit: false,
    noOpen: true,
    prefetch: 3,
    rate: 1,
    rateExplicit: false,
    stdin: true,
    text: '',
    voice: 'af_heart',
    voiceExplicit: false,
    workers: 1,
  });
});

test('speak args accept selected text options', () => {
  assert.deepEqual(parseSpeakArgs(['speak', '--voice', 'daniel', '--rate', '1.25', 'Read me']), {
    batch: true,
    controller: false,
    daemon: false,
    help: false,
    mode: 'fast-start',
    modeExplicit: false,
    noOpen: true,
    prefetch: 3,
    rate: 1.25,
    rateExplicit: true,
    stdin: false,
    text: 'Read me',
    voice: 'daniel',
    voiceExplicit: true,
    workers: 1,
  });
});

test('speak args can disable sentence batching', () => {
  assert.equal(parseSpeakArgs(['speak', '--no-batch', 'Read me']).batch, false);
});

test('speak args accept the macOS controller flag and legacy popup alias', () => {
  assert.equal(parseSpeakArgs(['speak', '--controller', 'Read me']).controller, true);
  assert.equal(parseSpeakArgs(['speak', '--popup', 'Read me']).controller, true);
});

test('speak args accept the local daemon flag', () => {
  assert.equal(parseSpeakArgs(['speak', '--daemon', 'Read me']).daemon, true);
});

test('speak args accept a bounded prefetch window', () => {
  assert.equal(parseSpeakArgs(['speak', '--prefetch', '5', 'Read me']).prefetch, 5);
  assert.equal(parseSpeakArgs(['speak', '--prefetch', '99', 'Read me']).prefetch, 6);
  assert.equal(parseSpeakArgs(['speak', '--prefetch', '0', 'Read me']).prefetch, 1);
});

test('speak args accept reading modes', () => {
  assert.equal(parseSpeakArgs(['speak', '--mode', 'auto', 'Read me']).mode, 'auto');
  assert.equal(parseSpeakArgs(['speak', '--auto', 'Read me']).mode, 'auto');
  assert.equal(parseSpeakArgs(['speak', '--mode', 'smooth', 'Read me']).mode, 'smooth');
  assert.equal(parseSpeakArgs(['speak', '--mode', 'smooth', 'Read me']).modeExplicit, true);
  assert.equal(parseSpeakArgs(['speak', '--smooth', 'Read me']).mode, 'smooth');
  assert.equal(parseSpeakArgs(['speak', '--smooth', 'Read me']).modeExplicit, true);
  assert.equal(parseSpeakArgs(['speak', '--whole-text', 'Read me']).mode, 'smooth');
  assert.equal(parseSpeakArgs(['speak', '--fast-start', 'Read me']).mode, 'fast-start');
  assert.equal(parseSpeakArgs(['speak', '--mode', 'nonsense', 'Read me']).mode, 'fast-start');
});

test('speak args accept a bounded worker count', () => {
  assert.equal(parseSpeakArgs(['speak', '--workers', '2', 'Read me']).workers, 2);
  assert.equal(parseSpeakArgs(['speak', '--workers', '99', 'Read me']).workers, 4);
  assert.equal(parseSpeakArgs(['speak', '--workers', '0', 'Read me']).workers, 1);
});

test('speakText auto mode keeps short text in fast-start batches', async () => {
  const home = mkdtempSync(join(tmpdir(), 'kokoro-reader-auto-short-home-'));
  const events = [];
  try {
    await speakText({
      home,
      mode: 'auto',
      text: 'One. Two.',
      synthesize: async (_actualHome, input) => {
        events.push(`synth:${input.text}`);
        return {
          cached: false,
          dir: join(home, 'Library', 'Application Support', 'Kokoro Reader', 'tts-cache', 'kokoro'),
          id: `${events.length}`.repeat(64),
          path: join(home, `${input.text}.wav`),
          voice: 'af_heart',
          langCode: 'a',
          rate: 1,
          url: `/api/tts/kokoro/${`${events.length}`.repeat(64)}.wav`,
        };
      },
      player: async (path) => {
        events.push(`play:${path.split('/').pop()}`);
      },
    });
    assert.deepEqual(events, [
      'synth:One. Two.',
      'play:One. Two..wav',
    ]);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('speakText auto mode streams long text in adaptive batches', async () => {
  const home = mkdtempSync(join(tmpdir(), 'kokoro-reader-auto-long-home-'));
  const text = `${'Long sentence. '.repeat(80)}Done.`;
  const events = [];
  try {
    await speakText({
      home,
      mode: 'auto',
      text,
      synthesize: async (_actualHome, input) => {
        events.push(`synth:${input.text}`);
        return {
          cached: false,
          dir: join(home, 'Library', 'Application Support', 'Kokoro Reader', 'tts-cache', 'kokoro'),
          id: `${events.length}`.repeat(64),
          path: join(home, `${events.length}.wav`),
          voice: 'af_heart',
          langCode: 'a',
          rate: 1,
          url: `/api/tts/kokoro/${`${events.length}`.repeat(64)}.wav`,
        };
      },
      player: async (path) => {
        events.push(`play:${path.split('/').pop()}`);
      },
    });
    const synthesized = events.filter((event) => event.startsWith('synth:')).map((event) => event.slice(6));
    const played = events.filter((event) => event.startsWith('play:'));
    assert.ok(synthesized.length > 1);
    assert.ok(synthesized[0].length <= 260);
    assert.ok(synthesized.slice(1).every((batch) => batch.length <= 650));
    assert.equal(synthesized.join(' '), text);
    assert.equal(played.length, synthesized.length);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('fast-start mode uses a smaller opening chunk than auto mode', () => {
  const text = `${'A useful sentence with enough detail to group naturally. '.repeat(20)}Done.`;
  const automatic = speechBatchesForMode(text, 'auto');
  const fast = speechBatchesForMode(text, 'fast-start');
  assert.ok(automatic.length > 1);
  assert.ok(fast.length > 1);
  assert.ok(fast[0].length <= 170);
  assert.ok(automatic[0].length > fast[0].length);
  assert.equal(fast.join(' '), text);
});

test('smooth mode batches long selections instead of sending an unbounded Kokoro request', async () => {
  const home = mkdtempSync(join(tmpdir(), 'kokoro-reader-smooth-home-'));
  const events = [];
  const text = Array.from({ length: 16 }, (_, index) => `Sentence ${index + 1} ${'detail '.repeat(10)}.`).join(' ');
  try {
    await speakText({
      home,
      mode: 'smooth',
      text,
      synthesize: async (_actualHome, input) => {
        events.push(`synth:${input.text}`);
        return {
          cached: false,
          dir: join(home, 'Library', 'Application Support', 'Kokoro Reader', 'tts-cache', 'kokoro'),
          id: `${events.length}`.repeat(64),
          path: join(home, `${input.text}.wav`),
          voice: 'af_heart',
          langCode: 'a',
          rate: 1,
          url: `/api/tts/kokoro/${`${events.length}`.repeat(64)}.wav`,
        };
      },
      player: async (path) => {
        events.push(`play:${path.split('/').pop()}`);
      },
    });
    const synthesized = events.filter((event) => event.startsWith('synth:')).map((event) => event.slice(6));
    const played = events.filter((event) => event.startsWith('play:'));
    assert.ok(synthesized.length > 1);
    assert.ok(synthesized.every((batch) => batch.length <= 900));
    assert.equal(synthesized.join(' '), text);
    assert.equal(played.length, synthesized.length);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('playAudio exposes pause and resume controls for the active player process', () => {
  const source = readFileSync(new URL('../src/speak.ts', import.meta.url), 'utf8');
  assert.match(source, /onPlaybackHandle/);
  assert.match(source, /child\.kill\('SIGSTOP'\)/);
  assert.match(source, /child\.kill\('SIGCONT'\)/);
});

test('audio playback command applies bounded macOS playback speed', () => {
  assert.deepEqual(audioPlayerCommand('/tmp/voice.wav', { platform: 'darwin', rate: 1.25 }), {
    command: '/usr/bin/afplay',
    args: ['--rate', '1.25', '--rQuality', '1', '/tmp/voice.wav'],
  });
  assert.deepEqual(audioPlayerCommand('/tmp/voice.wav', { platform: 'darwin', rate: 1 }), {
    command: '/usr/bin/afplay',
    args: ['/tmp/voice.wav'],
  });
  assert.deepEqual(audioPlayerCommand('/tmp/voice.wav', { platform: 'darwin', rate: 3 }), {
    command: '/usr/bin/afplay',
    args: ['--rate', '1.5', '--rQuality', '1', '/tmp/voice.wav'],
  });
});

test('splitTextIntoSpeechBatches keeps the first chunk short and groups later sentences', () => {
  const text = Array.from({ length: 8 }, (_, i) => `Sentence ${i + 1} ${'detail '.repeat(12)}.`).join(' ');
  const batches = splitTextIntoSpeechBatches(text);
  assert.ok(batches.length > 1);
  assert.ok(batches[0].length <= 260);
  assert.ok(batches.slice(1).every((batch) => batch.length <= 650));
  assert.equal(batches.join(' '), text);
});

test('splitTextIntoSpeechBatches splits very long sentences at word boundaries', () => {
  const words = Array.from({ length: 80 }, (_, i) => `word${i}`).join(' ');
  const batches = splitTextIntoSpeechBatches(words, 120);
  assert.ok(batches.length > 1);
  assert.ok(batches.every((batch) => batch.length <= 120));
  assert.equal(batches.join(' '), words);
});

test('splitTextIntoSpeechBatches prefers clause boundaries for long sentences', () => {
  const text = 'This part is long enough to split, and this clause should remain together, while this ending should be another chunk.';
  assert.deepEqual(splitTextIntoSpeechBatches(text, 54), [
    'This part is long enough to split,',
    'and this clause should remain together,',
    'while this ending should be another chunk.',
  ]);
});

test('speakText rejects empty selected text before synthesis', async () => {
  await assert.rejects(
    () => speakText({
      home: tmpdir(),
      text: '   ',
      synthesize: async () => {
        throw new Error('synthesis should not run');
      },
      player: async () => {
        throw new Error('player should not run');
      },
    }),
    /No text to speak/,
  );
});

test('speakText synthesizes selected text and plays the cached wav', async () => {
  const home = mkdtempSync(join(tmpdir(), 'kokoro-reader-speak-home-'));
  const played = [];
  try {
    const result = await speakText({
      home,
      text: 'Hello from selection',
      voice: 'heart',
      rate: 1.25,
      synthesize: async (actualHome, input) => {
        assert.equal(actualHome, home);
        assert.deepEqual(input, {
          text: 'Hello from selection',
          voice: 'heart',
          rate: 1.25,
        });
        return {
          cached: false,
          dir: join(home, 'Library', 'Application Support', 'Kokoro Reader', 'tts-cache', 'kokoro'),
          id: 'b'.repeat(64),
          path: join(home, 'Library', 'Application Support', 'Kokoro Reader', 'tts-cache', 'kokoro', `${'b'.repeat(64)}.wav`),
          voice: 'af_heart',
          langCode: 'a',
          rate: 1.25,
          url: `/api/tts/kokoro/${'b'.repeat(64)}.wav`,
        };
      },
      player: async (path) => {
        played.push(path);
      },
    });
    assert.equal(result.path, played[0]);
    assert.equal(result.cached, false);
    assert.equal(played.length, 1);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('speakText prefetches the next sentence while the current sentence plays', async () => {
  const home = mkdtempSync(join(tmpdir(), 'kokoro-reader-batch-home-'));
  const events = [];
  const progress = [];
  const first = `First ${'detail '.repeat(42)}.`;
  const second = `Second ${'detail '.repeat(42)}.`;
  try {
    await speakText({
      home,
      text: `${first} ${second}`,
      voice: 'heart',
      rate: 1,
      synthesize: async (actualHome, input) => {
        assert.equal(actualHome, home);
        events.push(`synth:${input.text}`);
        return {
          cached: false,
          dir: join(home, 'Library', 'Application Support', 'Kokoro Reader', 'tts-cache', 'kokoro'),
          id: `${events.length}`.repeat(64),
          path: join(home, `${input.text.startsWith('First') ? 'first' : 'second'}.wav`),
          voice: 'af_heart',
          langCode: 'a',
          rate: 1,
          url: `/api/tts/kokoro/${`${events.length}`.repeat(64)}.wav`,
        };
      },
      player: async (path) => {
        events.push(`play:${path.endsWith('first.wav') ? 'first' : 'second'}`);
        if (path.endsWith('first.wav')) {
          assert.ok(events.includes(`synth:${second}`));
        }
      },
      onProgress: (event) => {
        progress.push(event);
      },
    });
    assert.deepEqual(events, [
      `synth:${first}`,
      `synth:${second}`,
      'play:first',
      'play:second',
    ]);
    assert.deepEqual(progress, [
      {
        chunkText: first,
        current: 0,
        message: 'Generating chunk 1 of 2',
        status: 'generating',
        total: 2,
      },
      {
        chunkText: first,
        current: 1,
        message: 'Reading chunk 1 of 2',
        status: 'reading',
        total: 2,
      },
      {
        chunkText: second,
        current: 1,
        message: 'Preparing chunk 2 of 2',
        status: 'generating',
        total: 2,
      },
      {
        chunkText: second,
        current: 2,
        message: 'Reading chunk 2 of 2',
        status: 'reading',
        total: 2,
      },
    ]);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('speakText reads live playback rate when playing prefetched batches', async () => {
  const home = mkdtempSync(join(tmpdir(), 'kokoro-reader-dynamic-rate-home-'));
  const playbackRates = [];
  let currentRate = 0.8;
  const first = `First ${'detail '.repeat(42)}.`;
  const second = `Second ${'detail '.repeat(42)}.`;
  try {
    await speakText({
      home,
      text: `${first} ${second}`,
      playbackRate: () => currentRate,
      rate: 1,
      synthesize: async (_actualHome, input) => {
        assert.equal(input.rate, 1);
        return {
          cached: false,
          dir: join(home, 'Library', 'Application Support', 'Kokoro Reader', 'tts-cache', 'kokoro'),
          id: `${input.text.startsWith('First') ? 1 : 2}`.repeat(64),
          path: join(home, `${input.text}.wav`),
          voice: 'af_heart',
          langCode: 'a',
          rate: input.rate,
          url: `/api/tts/kokoro/${`${input.text.startsWith('First') ? 1 : 2}`.repeat(64)}.wav`,
        };
      },
      player: async (_path, opts) => {
        playbackRates.push(opts?.rate);
        currentRate = 1.25;
      },
    });
    assert.deepEqual(playbackRates, [0.8, 1.25]);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('speakText prefetches multiple future sentences before first playback', async () => {
  const home = mkdtempSync(join(tmpdir(), 'kokoro-reader-prefetch-home-'));
  const events = [];
  const sentences = ['One', 'Two', 'Three', 'Four'].map((label) => `${label} ${'detail '.repeat(50)}.`);
  try {
    await speakText({
      home,
      prefetch: 3,
      text: sentences.join(' '),
      synthesize: async (_actualHome, input) => {
        events.push(`synth:${input.text}`);
        return {
          cached: false,
          dir: join(home, 'Library', 'Application Support', 'Kokoro Reader', 'tts-cache', 'kokoro'),
          id: `${events.length}`.repeat(64),
          path: join(home, `${input.text}.wav`),
          voice: 'af_heart',
          langCode: 'a',
          rate: 1,
          url: `/api/tts/kokoro/${`${events.length}`.repeat(64)}.wav`,
        };
      },
      player: async (path) => {
        if (path.endsWith(`${sentences[0]}.wav`)) {
          assert.deepEqual(events.slice(0, 4), [
            `synth:${sentences[0]}`,
            `synth:${sentences[1]}`,
            `synth:${sentences[2]}`,
            `synth:${sentences[3]}`,
          ]);
        }
        events.push(`play:${path.split('/').pop()}`);
      },
    });
    assert.deepEqual(events, [
      `synth:${sentences[0]}`,
      `synth:${sentences[1]}`,
      `synth:${sentences[2]}`,
      `synth:${sentences[3]}`,
      `play:${sentences[0]}.wav`,
      `play:${sentences[1]}.wav`,
      `play:${sentences[2]}.wav`,
      `play:${sentences[3]}.wav`,
    ]);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
