import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { handle } from '../dist/server.js';
import { kokoroTtsCacheDir } from '../dist/kokoro-tts.js';

test('reader page renders the core app controls', async () => {
  const { req, res } = mockRequest('GET', '/', '');
  handle(req, res);
  await res.done;
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Aloud/);
  assert.match(res.body, /data-reader-app/);
  assert.match(res.body, /data-listening-desk/);
  assert.match(res.body, /class="document-panel"/);
  assert.match(res.body, /class="control-rail"/);
  assert.match(res.body, /class="player-shell"/);
  assert.match(res.body, /Reading shelf/);
  assert.match(res.body, /font-family: "Kokoro Manrope"/);
  assert.match(res.body, /font-family: "Kokoro Atkinson"/);
  assert.match(res.body, /\/assets\/fonts\/Manrope-Variable\.ttf/);
  assert.match(res.body, /\/assets\/fonts\/AtkinsonHyperlegibleNext-Variable\.ttf/);
  assert.doesNotMatch(res.body, /Iowan Old Style/);
  assert.match(res.body, /data-play/);
  assert.match(res.body, /data-export/);
  assert.match(res.body, /Save voice file/);
  assert.match(res.body, /option value="af_heart"/);
  assert.match(res.body, /option value="bm_daniel"/);
  assert.match(res.body, /\/api\/reader\/status/);
  assert.match(res.body, /\/api\/reader\/speak/);
  assert.match(res.body, /data-reading-view/);
  assert.match(res.body, /textarea\[hidden\] \{ display: none; \}/);
  assert.match(res.body, /data-active-chunk/);
  assert.doesNotMatch(res.body, /data-now-reading/);
  assert.match(res.body, /data-file-input/);
  assert.match(res.body, /data-drop-prompt/);
  assert.match(res.body, /lastClearedText/);
  assert.match(res.body, /localStatusUntil/);
  assert.match(res.body, /playbackEndedAt/);
  assert.match(res.body, /completedChunks/);
  assert.match(res.body, /aria-valuetext/);
  assert.match(res.body, /setLocalStatus/);
  assert.match(res.body, /player-shell\.is-running \.progress-bar/);
  assert.match(res.body, /data-health-grid/);
  assert.match(res.body, /data-history-enabled/);
  assert.match(res.body, /aria-live="polite"/);
  assert.match(res.body, /!next\.running && wasRunning/);
  assert.doesNotMatch(res.body, /audioContext\.createBufferSource/);
  assert.doesNotMatch(res.body, /data-highlight-toggle/);
  assert.doesNotMatch(res.body, /data-highlight-panel/);
  assert.doesNotMatch(res.body, /reader-word/);
  assert.doesNotMatch(res.body, /aloud-highlight/);
  assert.doesNotMatch(res.body, /class="config-bar"/);
  assert.doesNotMatch(res.body, /class="reader-card"/);
});

test('reader serves its bundled fonts locally with immutable caching', async () => {
  const { req, res } = mockRequest('GET', '/assets/fonts/Manrope-Variable.ttf', '');
  handle(req, res);
  await res.done;
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['content-type'], 'font/ttf');
  assert.equal(res.headers['cache-control'], 'public, max-age=31536000, immutable');
  assert.ok(Number(res.headers['content-length']) > 100_000);
  assert.ok(res.body.length > 100_000);
});

test('reader status API proxies the shared daemon state', async () => {
  const expected = readerStatus({ running: true, state: { chunkEnd: 12, chunkStart: 4, chunkText: 'secret text', message: 'Reading', status: 'reading' } });
  const reader = mockReader(expected);
  const { req, res } = mockRequest('GET', '/api/reader/status', '');
  handle(req, res, undefined, reader);
  await res.done;
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), {
    ...expected,
    state: { chunkEnd: 12, chunkStart: 4, message: 'Reading', status: 'reading' },
  });
});

test('reader rejects non-local and cross-site requests before dispatch', async () => {
  const badHost = mockRequest('GET', '/api/reader/status', '', { host: 'attacker.example' });
  handle(badHost.req, badHost.res, undefined, mockReader(readerStatus()));
  await badHost.res.done;
  assert.equal(badHost.res.statusCode, 403);

  const crossSite = mockRequest('POST', '/api/reader/control', JSON.stringify({ action: 'stop' }), {
    host: 'localhost:7878',
    origin: 'https://attacker.example',
    'sec-fetch-site': 'cross-site',
  });
  handle(crossSite.req, crossSite.res, undefined, mockReader(readerStatus()));
  await crossSite.res.done;
  assert.equal(crossSite.res.statusCode, 403);
});

test('reader requires JSON and its HttpOnly local session for mutations', async () => {
  const reader = mockReader(readerStatus());
  const options = { requireSession: true, sessionToken: 'test-session' };
  const page = mockRequest('GET', '/', '');
  handle(page.req, page.res, undefined, reader, undefined, options);
  await page.res.done;
  assert.match(page.res.headers['set-cookie'], /aloud_session=test-session/);
  assert.match(page.res.headers['set-cookie'], /HttpOnly/);
  assert.match(page.res.headers['set-cookie'], /SameSite=Strict/);

  const missingCookie = mockRequest('POST', '/api/reader/control', JSON.stringify({ action: 'stop' }));
  handle(missingCookie.req, missingCookie.res, undefined, reader, undefined, options);
  await missingCookie.res.done;
  assert.equal(missingCookie.res.statusCode, 403);

  const wrongType = mockRequest('POST', '/api/reader/control', JSON.stringify({ action: 'stop' }), {
    'content-type': 'text/plain',
    cookie: 'aloud_session=test-session',
  });
  handle(wrongType.req, wrongType.res, undefined, reader, undefined, options);
  await wrongType.res.done;
  assert.equal(wrongType.res.statusCode, 415);

  const allowed = mockRequest('POST', '/api/reader/control', JSON.stringify({ action: 'stop' }), {
    cookie: 'aloud_session=test-session',
    origin: 'http://localhost:7878',
    'sec-fetch-site': 'same-origin',
  });
  handle(allowed.req, allowed.res, undefined, reader, undefined, options);
  await allowed.res.done;
  assert.equal(allowed.res.statusCode, 200);
  assert.deepEqual(reader.calls.control, ['stop']);
});

test('reader returns a JSON 413 for a byte-counted oversized body', async () => {
  const { req, res } = mockRequest('POST', '/api/tts/kokoro/plan', 'x'.repeat(2 * 1024 * 1024 + 1));
  handle(req, res);
  await res.done;
  assert.equal(res.statusCode, 413);
  assert.match(JSON.parse(res.body).error, /byte limit/);
});

test('reader reports and clears old cache entries while preserving the cache contract', async () => {
  const home = mkdtempSync(join(tmpdir(), 'aloud-server-cache-'));
  try {
    const dir = kokoroTtsCacheDir(home);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `${'a'.repeat(64)}.wav`);
    writeFileSync(path, wavBytes(96));
    const old = new Date(Date.now() - 10 * 60 * 1000);
    utimesSync(path, old, old);

    const get = mockRequest('GET', '/api/system/cache', '');
    handle(get.req, get.res, undefined, undefined, undefined, { home });
    await get.res.done;
    assert.deepEqual({ entries: JSON.parse(get.res.body).entries, bytes: JSON.parse(get.res.body).bytes }, { entries: 1, bytes: 96 });

    const clear = mockRequest('POST', '/api/system/cache', JSON.stringify({ action: 'clear' }));
    handle(clear.req, clear.res, undefined, undefined, undefined, { home });
    await clear.res.done;
    assert.equal(clear.res.statusCode, 200);
    assert.deepEqual({ entries: JSON.parse(clear.res.body).entries, removedEntries: JSON.parse(clear.res.body).removedEntries }, { entries: 0, removedEntries: 1 });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('reader settings API updates the shared daemon', async () => {
  const reader = mockReader(readerStatus());
  const { req, res } = mockRequest('POST', '/api/reader/settings', JSON.stringify({ mode: 'smooth', rate: 1.25, shortcut: 'option+space', voice: 'bm_daniel' }));
  handle(req, res, undefined, reader);
  await res.done;
  assert.equal(res.statusCode, 200);
  assert.deepEqual(reader.calls.settings, [{ mode: 'smooth', rate: 1.25, shortcut: 'option+space', voice: 'bm_daniel' }]);
});

test('reader transport API delegates pause and exact chunk navigation', async () => {
  const reader = mockReader(readerStatus());
  const pause = mockRequest('POST', '/api/reader/control', JSON.stringify({ action: 'pause' }));
  handle(pause.req, pause.res, undefined, reader);
  await pause.res.done;
  const next = mockRequest('POST', '/api/reader/seek', JSON.stringify({ action: 'next' }));
  handle(next.req, next.res, undefined, reader);
  await next.res.done;
  assert.deepEqual(reader.calls.control, ['pause']);
  assert.deepEqual(reader.calls.seek, ['next']);
});

function readerStatus(overrides = {}) {
  return {
    canGoNext: false,
    canGoPrevious: false,
    canReplay: false,
    mode: 'auto',
    modeLabel: 'Auto',
    ok: true,
    paused: false,
    rate: 1,
    running: false,
    shortcut: 'option+r',
    shortcutLabel: 'Option + R',
    state: { message: 'Ready', status: 'done' },
    voice: 'af_heart',
    voiceLabel: 'Heart',
    ...overrides,
  };
}

function mockReader(status) {
  const calls = { control: [], seek: [], settings: [], speak: [] };
  return {
    calls,
    async control(action) { calls.control.push(action); },
    async seek(action) { calls.seek.push(action); return status; },
    async settings(input) { calls.settings.push(input); return status; },
    async speak(input) { calls.speak.push(input); return status; },
    async status() { return status; },
  };
}

test('kokoro planning API creates adaptive playback batches without synthesis', async () => {
  const text = Array.from({ length: 8 }, (_, i) => `Sentence ${i + 1} ${'detail '.repeat(12)}.`).join(' ');
  const { req, res } = mockRequest('POST', '/api/tts/kokoro/plan', JSON.stringify({ text }));
  handle(req, res, async () => {
    throw new Error('synth should not run');
  });
  await res.done;
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.ok(body.batches.length > 1);
  assert.ok(body.batches[0].length <= 260);
  assert.ok(body.batches.slice(1).every((batch) => batch.length <= 650));
  assert.equal(body.batches.join(' '), text);
});

test('kokoro api validates invalid JSON without running synthesis', async () => {
  const { req, res } = mockRequest('POST', '/api/tts/kokoro', '{bad');
  handle(req, res, async () => {
    throw new Error('synth should not run');
  });
  await res.done;
  assert.equal(res.statusCode, 400);
  assert.deepEqual(JSON.parse(res.body), { error: 'invalid JSON' });
});

test('kokoro api enforces the shared document character limit before synthesis', async () => {
  let called = false;
  const { req, res } = mockRequest('POST', '/api/tts/kokoro', JSON.stringify({ text: 'x'.repeat(240_001) }));
  handle(req, res, async () => {
    called = true;
    throw new Error('must not run');
  });
  await res.done;
  assert.equal(res.statusCode, 413);
  assert.equal(called, false);
});

test('kokoro api surfaces synthesis validation errors', async () => {
  const { req, res } = mockRequest('POST', '/api/tts/kokoro', JSON.stringify({ text: '' }));
  handle(req, res, async () => {
    throw new Error('No text to speak.');
  });
  await res.done;
  assert.equal(res.statusCode, 400);
  assert.deepEqual(JSON.parse(res.body), { error: 'No text to speak.' });
});

test('kokoro api returns generated audio metadata', async () => {
  const { req, res } = mockRequest('POST', '/api/tts/kokoro', JSON.stringify({ text: 'hello', voice: 'af_heart', rate: 1 }));
  handle(req, res, async (home, input) => ({
    cached: true,
    dir: join(home, 'Library', 'Application Support', 'Aloud', 'tts-cache', 'kokoro'),
    id: 'a'.repeat(64),
    path: join(home, 'Library', 'Application Support', 'Aloud', 'tts-cache', 'kokoro', `${'a'.repeat(64)}.wav`),
    voice: input.voice,
    langCode: 'a',
    rate: input.rate,
    url: `/api/tts/kokoro/${'a'.repeat(64)}.wav`,
  }));
  await res.done;
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), {
    cached: true,
    engine: 'kokoro',
    rate: 1,
    url: `/api/tts/kokoro/${'a'.repeat(64)}.wav`,
    voice: 'af_heart',
  });
});

test('voice export API starts, reports, and cancels a background WAV job', async () => {
  const calls = { cancel: [], start: [] };
  const status = {
    current: 0,
    filename: 'Chapter.wav',
    id: '12345678-1234-1234-1234-123456789abc',
    message: 'Generating part 1 of 3…',
    progress: 0,
    rate: 1,
    state: 'generating',
    total: 3,
    voice: 'af_heart',
  };
  const exports = {
    cancel(id) { calls.cancel.push(id); return { ...status, message: 'Voice file export cancelled.', state: 'cancelled' }; },
    dispose() {},
    file() { return undefined; },
    get(id) { return id === status.id ? status : undefined; },
    start(input) { calls.start.push(input); return status; },
  };

  const start = mockRequest('POST', '/api/exports', JSON.stringify({ text: 'A long chapter.', voice: 'af_heart', rate: 1 }));
  handle(start.req, start.res, undefined, undefined, undefined, { exports });
  await start.res.done;
  assert.equal(start.res.statusCode, 200);
  assert.deepEqual(calls.start, [{ text: 'A long chapter.', voice: 'af_heart', rate: 1 }]);
  assert.equal(JSON.parse(start.res.body).id, status.id);

  const poll = mockRequest('GET', `/api/exports/${status.id}`, '');
  handle(poll.req, poll.res, undefined, undefined, undefined, { exports });
  await poll.res.done;
  assert.equal(JSON.parse(poll.res.body).state, 'generating');

  const cancel = mockRequest('POST', `/api/exports/${status.id}/cancel`, '{}');
  handle(cancel.req, cancel.res, undefined, undefined, undefined, { exports });
  await cancel.res.done;
  assert.equal(JSON.parse(cancel.res.body).state, 'cancelled');
  assert.deepEqual(calls.cancel, [status.id]);
});

function mockRequest(method, url, body, headers = {}) {
  const listeners = {};
  const req = {
    headers: {
      host: 'localhost:7878',
      ...(method === 'POST' ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    method,
    url,
    on(event, callback) {
      listeners[event] = callback;
      return this;
    },
    destroy() {},
    resume() {},
  };
  let resolveDone;
  const res = {
    statusCode: 200,
    headers: {},
    body: '',
    destroyed: false,
    writableEnded: false,
    done: new Promise((resolve) => {
      resolveDone = resolve;
    }),
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    on() {
      return this;
    },
    end(chunk = '') {
      this.body += String(chunk);
      this.writableEnded = true;
      resolveDone();
    },
  };
  queueMicrotask(() => {
    if (listeners.data && body) listeners.data(Buffer.from(body));
    if (listeners.end) listeners.end();
  });
  return { req, res };
}

function wavBytes(size = 64) {
  const buffer = Buffer.alloc(Math.max(44, size));
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  return buffer;
}
