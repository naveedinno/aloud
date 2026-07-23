import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  createSerializedExecutor,
  createSingleFlight,
  DAEMON_CAPABILITIES,
  DAEMON_PROTOCOL,
  DAEMON_SERVICE,
  isSpeechDaemonHealth,
  runSpeechDaemon,
} from '../dist/daemon.js';
import { speechBatchesForMode, speechChunkRanges } from '../dist/speak.js';

const source = readFileSync(new URL('../src/daemon.ts', import.meta.url), 'utf8');

test('speech daemon tracks menu bar voice selection for plain reads', () => {
  assert.match(source, /const RANDOM_VOICE = 'random'/);
  assert.match(source, /loadReaderPreferences\(home\)/);
  assert.match(source, /let currentMode: SpeechMode = speechMode\(storedPreferences\.mode/);
  assert.match(source, /request\.method === 'POST' && request\.url === '\/mode'/);
  assert.match(source, /request\.method === 'POST' && request\.url === '\/pause'/);
  assert.match(source, /request\.method === 'POST' && request\.url === '\/resume'/);
  assert.match(source, /currentMode = speechMode\(body\.mode\)/);
  assert.match(source, /currentMode = speechMode\(body\.mode \?\? currentMode\)/);
  assert.match(source, /mode: currentMode/);
  assert.match(source, /modeLabel: speechModeLabel\(currentMode\)/);
  assert.match(source, /let currentEngine = normalizeSpeechEngine\(storedPreferences\.engine/);
  assert.match(source, /let currentVoice = normalizeDaemonVoice\(currentEngine, storedPreferences\.voice/);
  assert.match(source, /request\.method === 'POST' && request\.url === '\/voice'/);
  assert.match(source, /currentVoice = normalizeDaemonVoice\(currentEngine, body\.voice\)/);
  assert.match(source, /currentVoice = normalizeDaemonVoice\(currentEngine, body\.voice \?\? currentVoice\)/);
  assert.match(source, /voice: selectedDaemonVoice\(currentEngine, currentVoice\)/);
  assert.match(source, /function daemonVoiceLabel/);
  assert.match(source, /function selectedDaemonVoice/);
  assert.match(source, /currentPlayback\?\.pause\(\)/);
  assert.match(source, /currentPlayback\?\.resume\(\)/);
  assert.match(source, /if \(!currentAbort \|\| currentPaused\) return;/);
  assert.match(source, /if \(!currentAbort \|\| !currentPaused\) return;/);
  assert.doesNotMatch(source, /updateState\(\{ message: 'Paused' \}\)/);
  assert.match(source, /pauseCurrent\(\);\s+return sendJson\(response, statusBody\(\)\);/);
  assert.match(source, /resumeCurrent\(\);\s+return sendJson\(response, statusBody\(\)\);/);
  assert.match(source, /request\.url === '\/settings'/);
  assert.match(source, /request\.url === '\/seek'/);
  assert.doesNotMatch(source, /chunkText\?: string/);
  assert.match(source, /speechChunkRanges\(input\.text, chunks\)/);
  assert.match(source, /const text = String\(body\.text \?\? ''\);/);
  assert.match(source, /if \(!text\.trim\(\)\)/);
  assert.match(source, /daemonSpeechBatches\(\{ \.\.\.body, text \}, currentMode\)/);
  assert.match(source, /Narration beats must match the supplied text in reading order/);
  assert.match(source, /chunkStart: range\?\.start/);
  assert.match(source, /chunkEnd: range\?\.end/);
  assert.match(source, /speechPrefetchForMode\(input\.mode\)/);
  assert.match(source, /normalizeGlobalShortcut/);
  assert.match(source, /saveReaderPreferences/);
});

test('speech daemon does not open the old overlay controller', () => {
  assert.doesNotMatch(source, /startSpeechController/);
  assert.doesNotMatch(source, /SpeechController,/);
  assert.doesNotMatch(source, /currentController/);
});

test('speech daemon keeps local model workers out of idle memory', () => {
  assert.doesNotMatch(source, /warmKokoroWorkers/);
  assert.doesNotMatch(source, /createKokoroSynthesizerSession/);
  assert.match(source, /createManagedSpeechSynthesizer\(home\)/);
  assert.match(source, /synthesizer\?\.dispose\(\)/);
});

test('speech daemon finishes cancellation before starting the replacement job', () => {
  assert.match(source, /stopCurrent\(\);\s+await currentJob;/);
  assert.match(source, /if \(currentJob === job\)/);
  assert.match(source, /if \(generation === currentGeneration\)/);
});

test('speech daemon command executor serializes overlapping mutations and recovers after errors', async () => {
  const execute = createSerializedExecutor();
  let active = 0;
  let maxActive = 0;
  const order = [];
  const command = (name, fail = false) => execute(async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    order.push(`start:${name}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
    order.push(`end:${name}`);
    active -= 1;
    if (fail) throw new Error(name);
    return name;
  });

  const results = await Promise.allSettled([command('speak'), command('seek', true), command('stop')]);
  assert.equal(maxActive, 1);
  assert.deepEqual(order, [
    'start:speak', 'end:speak',
    'start:seek', 'end:seek',
    'start:stop', 'end:stop',
  ]);
  assert.deepEqual(results.map((result) => result.status), ['fulfilled', 'rejected', 'fulfilled']);
});

test('speech daemon cold start is shared by simultaneous callers', async () => {
  let starts = 0;
  let release;
  const started = new Promise((resolve) => { release = resolve; });
  const startOnce = createSingleFlight(async () => {
    starts += 1;
    await started;
  });

  const first = startOnce();
  const second = startOnce();
  assert.equal(first, second);
  assert.equal(starts, 1);
  release();
  await Promise.all([first, second]);
  await startOnce();
  assert.equal(starts, 2);
});

test('speech daemon health requires the exact service and protocol identity', () => {
  assert.equal(isSpeechDaemonHealth({ ok: true }), false);
  assert.equal(isSpeechDaemonHealth({ capabilities: [...DAEMON_CAPABILITIES], ok: true, protocolVersion: DAEMON_PROTOCOL, service: 'another-local-service' }), false);
  assert.equal(isSpeechDaemonHealth({ capabilities: [], ok: true, protocolVersion: DAEMON_PROTOCOL, service: DAEMON_SERVICE }), false);
  assert.equal(isSpeechDaemonHealth({ capabilities: [...DAEMON_CAPABILITIES], ok: true, protocolVersion: DAEMON_PROTOCOL, service: DAEMON_SERVICE }), true);
});

test('speech daemon preserves explicit narration beats and prefetches ahead of playback', async () => {
  const home = mkdtempSync(join(tmpdir(), 'aloud-explicit-beats-'));
  const beats = ['First tiny beat.', 'Second tiny beat.'];
  const events = [];
  let releaseFirstPlayback;
  const firstPlaybackStarted = new Promise((resolve) => {
    releaseFirstPlayback = resolve;
  });
  const server = await runSpeechDaemon({
    home,
    port: 0,
    signals: false,
    synthesize: async (_actualHome, input) => {
      events.push(`synthesize:${input.text}`);
      return {
        cached: false,
        dir: home,
        id: `${events.length}`.repeat(64),
        path: join(home, input.text.startsWith('First') ? 'first.wav' : 'second.wav'),
        voice: 'af_heart',
        langCode: 'a',
        rate: 1,
        url: `/api/tts/kokoro/${`${events.length}`.repeat(64)}.wav`,
      };
    },
    player: async (path) => {
      const name = path.endsWith('first.wav') ? 'first' : 'second';
      events.push(`play:${name}`);
      if (name === 'first') {
        await firstPlaybackStarted;
      }
    },
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;

  try {
    const invalid = await fetch(`${base}/speak`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        batches: beats,
        text: beats[0],
      }),
    });
    assert.equal(invalid.status, 400);
    assert.match((await invalid.json()).error, /must match the supplied text/);
    assert.deepEqual(events, []);

    const response = await fetch(`${base}/speak`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        batches: beats,
        prefetch: 2,
        text: beats.join(' '),
      }),
    });
    assert.equal(response.status, 200);
    const started = await response.json();
    assert.equal(started.state.total, 2);

    for (let attempt = 0; attempt < 100 && !events.includes(`synthesize:${beats[1]}`); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    assert.deepEqual(events.slice(0, 3), [
      `synthesize:${beats[0]}`,
      `synthesize:${beats[1]}`,
      'play:first',
    ]);
    releaseFirstPlayback();
  } finally {
    releaseFirstPlayback();
    const closed = new Promise((resolve) => server.once('close', resolve));
    await fetch(`${base}/shutdown`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    await closed;
    rmSync(home, { recursive: true, force: true });
  }
});

test('speech daemon shuts down through its scoped local endpoint', async () => {
  const server = await runSpeechDaemon({
    port: 0,
    signals: false,
    synthesize: async () => { throw new Error('not used'); },
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const closed = new Promise((resolve) => server.once('close', resolve));
  const response = await fetch(`http://127.0.0.1:${address.port}/shutdown`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, stopped: true });
  await closed;
  assert.equal(server.listening, false);
});

test('speech daemon seeks from the live chunk and preserves job ownership', async () => {
  const home = mkdtempSync(join(tmpdir(), 'aloud-daemon-'));
  const text = Array.from({ length: 42 }, (_, index) => `Sentence ${index + 1} has enough useful detail to form several reading chunks.`).join(' ');
  const chunks = speechBatchesForMode(text, 'fast-start');
  const ranges = speechChunkRanges(text, chunks);
  assert.ok(chunks.length >= 3);
  let playCount = 0;
  const player = async (_path, options = {}) => {
    playCount += 1;
    if (playCount === 1) return;
    await new Promise((resolve, reject) => {
      const abort = () => reject(Object.assign(new Error('stopped'), { name: 'AbortError' }));
      if (options.signal?.aborted) abort();
      else options.signal?.addEventListener('abort', abort, { once: true });
    });
  };
  const server = await runSpeechDaemon({
    home,
    player,
    port: 0,
    signals: false,
    synthesize: async (_actualHome, input) => ({
      cached: false,
      dir: home,
      id: 'a'.repeat(64),
      path: join(home, `${input.text.length}.wav`),
      voice: 'af_heart',
      langCode: 'a',
      rate: 1,
      url: `/api/tts/kokoro/${'a'.repeat(64)}.wav`,
    }),
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  const post = async (path, body, headers = {}) => {
    const response = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
    return { response, body: await response.json() };
  };

  try {
    const rejected = await post('/speak', { text }, { Origin: 'https://example.com' });
    assert.equal(rejected.response.status, 403);

    const started = await post('/speak', { mode: 'fast-start', text });
    assert.equal(started.response.status, 200);
    const jobId = started.body.jobId;
    assert.match(jobId, /^[0-9a-f-]{36}$/i);

    let live;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      live = await fetch(`${base}/status`).then((response) => response.json());
      if (live.state.chunkStart === ranges[1]?.start && live.state.status === 'reading') break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(live.state.chunkStart, ranges[1]?.start);

    const next = await post('/seek', { action: 'next' });
    assert.equal(next.response.status, 200);
    assert.equal(next.body.jobId, jobId);
    assert.equal(next.body.state.chunkStart, ranges[2]?.start);
    assert.equal(next.body.canGoPrevious, true);

    const replay = await post('/seek', { action: 'replay' });
    assert.equal(replay.response.status, 200);
    assert.equal(replay.body.jobId, jobId);
    assert.equal(replay.body.state.chunkStart, ranges[2]?.start);
  } finally {
    const closed = new Promise((resolve) => server.once('close', resolve));
    await post('/shutdown', {});
    await closed;
    rmSync(home, { recursive: true, force: true });
  }
});
