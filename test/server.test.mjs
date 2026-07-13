import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';
import { handle } from '../dist/server.js';

test('reader page renders the core app controls', async () => {
  const { req, res } = mockRequest('GET', '/', '');
  handle(req, res);
  await res.done;
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Kokoro Reader/);
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
  assert.match(res.body, /option value="af_heart"/);
  assert.match(res.body, /option value="bm_daniel"/);
  assert.match(res.body, /\/api\/reader\/status/);
  assert.match(res.body, /\/api\/reader\/speak/);
  assert.match(res.body, /data-now-reading/);
  assert.match(res.body, /data-health-grid/);
  assert.match(res.body, /data-history-enabled/);
  assert.match(res.body, /aria-live="polite"/);
  assert.match(res.body, /staleIdleError/);
  assert.doesNotMatch(res.body, /audioContext\.createBufferSource/);
  assert.doesNotMatch(res.body, /data-highlight-toggle/);
  assert.doesNotMatch(res.body, /data-highlight-panel/);
  assert.doesNotMatch(res.body, /reader-word/);
  assert.doesNotMatch(res.body, /kokoro-reader-highlight/);
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
  const expected = readerStatus({ running: true });
  const reader = mockReader(expected);
  const { req, res } = mockRequest('GET', '/api/reader/status', '');
  handle(req, res, undefined, reader);
  await res.done;
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), expected);
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
    async speak(input) { calls.speak.push(input); },
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
    dir: join(home, 'Library', 'Application Support', 'Kokoro Reader', 'tts-cache', 'kokoro'),
    id: 'a'.repeat(64),
    path: join(home, 'Library', 'Application Support', 'Kokoro Reader', 'tts-cache', 'kokoro', `${'a'.repeat(64)}.wav`),
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

function mockRequest(method, url, body) {
  const listeners = {};
  const req = {
    method,
    url,
    on(event, callback) {
      listeners[event] = callback;
      return this;
    },
    destroy() {},
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
