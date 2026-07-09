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
  assert.match(res.body, /data-play/);
  assert.match(res.body, /data-voice="af_heart"/);
  assert.match(res.body, /data-voice="bm_daniel"/);
  assert.doesNotMatch(res.body, /data-highlight-toggle/);
  assert.doesNotMatch(res.body, /data-highlight-panel/);
  assert.doesNotMatch(res.body, /reader-word/);
  assert.doesNotMatch(res.body, /kokoro-reader-highlight/);
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
