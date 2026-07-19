import { closeSync, createReadStream, existsSync, fstatSync, openSync, readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MAX_READER_TEXT_CHARACTERS, renderPage } from './page.js';
import {
  configureSpeechDaemon,
  controlSpeechDaemon,
  getSpeechDaemonStatus,
  seekSpeechDaemon,
  sendSpeakToDaemon,
  type SpeechDaemonControl,
  type SpeechDaemonRequest,
  type SpeechDaemonSeek,
  type SpeechDaemonSettings,
  type SpeechDaemonStatus,
} from './daemon.js';
import {
  clearKokoroTtsCache,
  isValidKokoroCacheFile,
  isKokoroTtsId,
  kokoroTtsCacheStats,
  kokoroTtsCacheDir,
  markKokoroCacheUsed,
  synthesizeWithKokoro,
} from './kokoro-tts.js';
import { splitTextIntoSpeechBatches } from './speak.js';
import {
  readerSystemHealth,
  runSystemRepair,
  type ReaderSystemHealth,
  type SystemRepairAction,
} from './system-health.js';
import {
  createVoiceExportManager,
  type VoiceExportBackend,
  type VoiceExportInput,
} from './voice-export.js';
import {
  createManagedSpeechSynthesizer,
  type SpeechSynthesisRequest,
  type SpeechSynthesisResult,
} from './speech-engine.js';
import {
  clearPocketTtsCache,
  isPocketTtsId,
  POCKET_CACHE_MAX_AGE_MS,
  POCKET_CACHE_MAX_BYTES,
  pocketTtsCacheDir,
  pocketTtsCacheStats,
} from './pocket-tts.js';

export interface ServeOptions {
  home?: string;
  port?: number;
  open?: boolean;
  reader?: ReaderBackend;
  signals?: boolean;
  synthesize?: Synthesizer;
  system?: SystemBackend;
}

export interface HandleOptions {
  exports?: VoiceExportBackend;
  home?: string;
  requireSession?: boolean;
  sessionToken?: string;
}

export type SynthResult = SpeechSynthesisResult;
export type Synthesizer = (home: string, input: SpeechSynthesisRequest, opts?: { signal?: AbortSignal }) => Promise<SynthResult>;

export interface ReaderBackend {
  control(action: SpeechDaemonControl): Promise<unknown>;
  seek(action: SpeechDaemonSeek): Promise<SpeechDaemonStatus>;
  settings(input: SpeechDaemonSettings): Promise<SpeechDaemonStatus>;
  speak(input: SpeechDaemonRequest): Promise<SpeechDaemonStatus>;
  status(): Promise<SpeechDaemonStatus>;
}

export interface SystemBackend {
  health(status?: SpeechDaemonStatus): ReaderSystemHealth;
  repair(action: SystemRepairAction): { message: string; started: boolean };
}

const DEFAULT_PORT = 7878;
const LOOPBACK_HOST = '127.0.0.1';
const MAX_JSON_BODY_BYTES = 2 * 1024 * 1024;
const SESSION_COOKIE = 'aloud_session';
const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FONT_ASSETS = new Map([
  ['Manrope-Variable.ttf', 'Manrope-Variable.ttf'],
  ['AtkinsonHyperlegibleNext-Variable.ttf', 'AtkinsonHyperlegibleNext-Variable.ttf'],
]);
const daemonReader: ReaderBackend = {
  control: controlSpeechDaemon,
  seek: seekSpeechDaemon,
  settings: configureSpeechDaemon,
  speak: sendSpeakToDaemon,
  status: getSpeechDaemonStatus,
};
const localSystem: SystemBackend = {
  health: (status) => readerSystemHealth(status),
  repair: (action) => runSystemRepair(action, PROJECT_ROOT),
};

export function serve(options: ServeOptions = {}): Server {
  const home = options.home ?? homedir();
  const sessionToken = randomBytes(32).toString('base64url');
  const managed = options.synthesize ? undefined : createManagedSpeechSynthesizer(home);
  const synthesize = options.synthesize ?? managed!.synthesize;
  const voiceExports = createVoiceExportManager(home, synthesize);
  const server = createServer((req, res) => handle(
    req,
    res,
    synthesize,
    options.reader ?? daemonReader,
    options.system ?? localSystem,
    { exports: voiceExports, home, requireSession: true, sessionToken },
  ));
  const port = options.port ?? DEFAULT_PORT;
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${port} is in use. Try: npm run dev -- --port ${port + 1}`);
      managed?.dispose();
      process.exitCode = 1;
      return;
    }
    console.error(`Server error: ${err.message}`);
    managed?.dispose();
    process.exitCode = 1;
  });
  const removeSignalHandlers = options.signals === false ? () => {} : installSignalCleanup(server);
  server.on('close', () => {
    removeSignalHandlers();
    voiceExports.dispose();
    managed?.dispose();
  });
  server.listen(port, LOOPBACK_HOST, () => {
    const addr = server.address();
    const actualPort = typeof addr === 'object' && addr ? addr.port : port;
    const url = `http://localhost:${actualPort}/`;
    console.log(`aloud ready -> ${url}`);
    if (options.open !== false) openBrowser(url);
  });
  return server;
}

export function handle(
  req: IncomingMessage,
  res: ServerResponse,
  synthesize: Synthesizer = async (home, input, opts) => ({
    ...await synthesizeWithKokoro(home, input, opts),
    engine: 'kokoro',
  }),
  reader: ReaderBackend = daemonReader,
  system: SystemBackend = localSystem,
  options: HandleOptions = {},
): void {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const securityError = localRequestError(req, options);
  if (securityError) {
    sendJson(res, securityError.status, { error: securityError.message });
    return;
  }
  const home = options.home ?? homedir();
  if (req.method === 'GET' && url.pathname === '/') {
    if (options.sessionToken) {
      res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${options.sessionToken}; HttpOnly; SameSite=Strict; Path=/`);
    }
    return sendHtml(res, renderPage());
  }
  if (req.method === 'GET' && url.pathname.startsWith('/assets/fonts/')) {
    return sendFont(res, url.pathname.slice('/assets/fonts/'.length));
  }
  if (req.method === 'GET' && url.pathname === '/api/reader/status') {
    return runJson(res, async () => publicReaderStatus(await reader.status()));
  }
  if (req.method === 'POST' && url.pathname === '/api/reader/settings') {
    return readBody(req, res, (body) => runJson(res, async () => publicReaderStatus(
      await reader.settings(parseJson<SpeechDaemonSettings>(body)),
    )));
  }
  if (req.method === 'POST' && url.pathname === '/api/reader/speak') {
    return readBody(req, res, (body) => runJson(res, async () => {
      const input = parseJson<SpeechDaemonRequest>(body);
      validateReaderText(input.text);
      return publicReaderStatus(await reader.speak(input));
    }));
  }
  if (req.method === 'POST' && url.pathname === '/api/reader/control') {
    return readBody(req, res, (body) => runJson(res, async () => {
      const { action } = parseJson<{ action?: SpeechDaemonControl }>(body);
      if (!action || !['pause', 'resume', 'stop'].includes(action)) throw new Error('Unknown playback action.');
      await reader.control(action);
      return publicReaderStatus(await reader.status());
    }));
  }
  if (req.method === 'POST' && url.pathname === '/api/reader/seek') {
    return readBody(req, res, (body) => runJson(res, async () => {
      const { action } = parseJson<{ action?: SpeechDaemonSeek }>(body);
      if (!action || !['next', 'previous', 'replay'].includes(action)) throw new Error('Unknown navigation action.');
      return publicReaderStatus(await reader.seek(action));
    }));
  }
  if (req.method === 'GET' && url.pathname === '/api/system/cache') {
    return sendJson(res, 200, publicCacheStats(allTtsCacheStats(home)));
  }
  if (req.method === 'POST' && url.pathname === '/api/system/cache') {
    return readBody(req, res, (body) => runJson(res, () => {
      const { action } = parseJson<{ action?: string }>(body);
      if (action !== 'clear') throw new Error('Unknown cache action.');
      const kokoro = clearKokoroTtsCache(home);
      const pocket = clearPocketTtsCache(home);
      return {
        ...publicCacheStats(allTtsCacheStats(home)),
        removedBytes: kokoro.removedBytes + pocket.removedBytes,
        removedEntries: kokoro.removedFiles + pocket.removedFiles,
      };
    }));
  }
  if (req.method === 'GET' && url.pathname === '/api/system/health') {
    return runJson(res, async () => {
      let status: SpeechDaemonStatus | undefined;
      try { status = await reader.status(); } catch {}
      return system.health(status);
    });
  }
  if (req.method === 'POST' && url.pathname === '/api/system/repair') {
    return readBody(req, res, (body) => runJson(res, async () => {
      const { action } = parseJson<{ action?: SystemRepairAction }>(body);
      if (!action || !['accessibility', 'kokoro', 'services'].includes(action)) throw new Error('Unknown setup action.');
      return system.repair(action);
    }));
  }
  if (req.method === 'POST' && url.pathname === '/api/tts/kokoro') {
    return readBody(req, res, (body) => runKokoro(res, body, synthesize, home));
  }
  if (req.method === 'POST' && url.pathname === '/api/tts/kokoro/plan') {
    return readBody(req, res, (body) => planKokoroSpeech(res, body));
  }
  if (req.method === 'POST' && url.pathname === '/api/exports') {
    return readBody(req, res, (body) => runJson(res, () => {
      if (!options.exports) throw new HttpStatusError(503, 'Voice file export is unavailable.');
      const input = parseJson<VoiceExportInput>(body);
      validateReaderText(input.text);
      return options.exports.start(input);
    }));
  }
  const exportRoute = /^\/api\/exports\/([a-f0-9-]+)(?:\/(file|cancel))?$/.exec(url.pathname);
  if (exportRoute && req.method === 'GET' && !exportRoute[2]) {
    const status = options.exports?.get(exportRoute[1]!);
    if (!status) return sendJson(res, 404, { error: 'Voice export not found.' });
    return sendJson(res, 200, status);
  }
  if (exportRoute && req.method === 'POST' && exportRoute[2] === 'cancel') {
    return readBody(req, res, () => {
      const status = options.exports?.cancel(exportRoute[1]!);
      if (!status) return sendJson(res, 404, { error: 'Voice export not found.' });
      return sendJson(res, 200, status);
    });
  }
  if (exportRoute && req.method === 'GET' && exportRoute[2] === 'file') {
    const file = options.exports?.file(exportRoute[1]!);
    if (!file) return sendJson(res, 404, { error: 'Voice file is not ready.' });
    return sendVoiceExportFile(res, file.path, file.filename);
  }
  if (req.method === 'GET' && url.pathname.startsWith('/api/tts/kokoro/')) {
    return sendKokoroAudio(res, url.pathname.slice('/api/tts/kokoro/'.length), home);
  }
  if (req.method === 'GET' && url.pathname.startsWith('/api/tts/pocket/')) {
    return sendPocketAudio(res, url.pathname.slice('/api/tts/pocket/'.length), home);
  }
  res.statusCode = 404;
  res.end('Not found');
}

function planKokoroSpeech(res: ServerResponse, body: string): void {
  let input: { text?: string };
  try {
    input = JSON.parse(body || '{}');
  } catch {
    sendJson(res, 400, { error: 'invalid JSON' });
    return;
  }
  const text = input.text ?? '';
  try {
    validateReaderText(text);
  } catch (err) {
    sendJson(res, httpStatus(err), { error: (err as Error).message });
    return;
  }
  const batches = splitTextIntoSpeechBatches(text);
  if (batches.length === 0) {
    sendJson(res, 400, { error: 'No text to speak.' });
    return;
  }
  sendJson(res, 200, { batches });
}

class HttpStatusError extends Error {
  constructor(readonly statusCode: number, message: string) {
    super(message);
    this.name = 'HttpStatusError';
  }
}

function localRequestError(
  req: IncomingMessage,
  options: HandleOptions,
): { message: string; status: number } | undefined {
  const host = headerValue(req, 'host');
  if (!host || !isLoopbackAuthority(host)) {
    return { message: 'Only local requests are allowed.', status: 403 };
  }
  if (req.method !== 'POST') return undefined;

  const fetchSite = headerValue(req, 'sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin') {
    return { message: 'Cross-site requests are not allowed.', status: 403 };
  }
  const origin = headerValue(req, 'origin');
  if (origin && !isSameLocalOrigin(origin, host)) {
    return { message: 'The request origin is not allowed.', status: 403 };
  }
  if (!isJsonContentType(headerValue(req, 'content-type'))) {
    return { message: 'POST requests require Content-Type: application/json.', status: 415 };
  }
  if (options.requireSession) {
    if (!options.sessionToken || !hasSessionCookie(headerValue(req, 'cookie'), options.sessionToken)) {
      return { message: 'A valid local reader session is required.', status: 403 };
    }
  }
  return undefined;
}

function headerValue(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers?.[name];
  return Array.isArray(value) ? value[0] : value;
}

function isLoopbackAuthority(authority: string): boolean {
  try {
    const hostname = new URL(`http://${authority}`).hostname.toLowerCase().replace(/\.$/, '');
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
  } catch {
    return false;
  }
}

function isSameLocalOrigin(originValue: string, host: string): boolean {
  try {
    const origin = new URL(originValue);
    return origin.protocol === 'http:'
      && isLoopbackAuthority(origin.host)
      && origin.host.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
}

function isJsonContentType(value: string | undefined): boolean {
  return String(value ?? '').split(';', 1)[0].trim().toLowerCase() === 'application/json';
}

function hasSessionCookie(value: string | undefined, expected: string): boolean {
  return String(value ?? '').split(';').some((part) => part.trim() === `${SESSION_COOKIE}=${expected}`);
}

function validateReaderText(value: unknown): void {
  const text = String(value ?? '');
  if (text.length > MAX_READER_TEXT_CHARACTERS) {
    throw new HttpStatusError(
      413,
      `Text is too long (${MAX_READER_TEXT_CHARACTERS.toLocaleString('en-US')} characters max).`,
    );
  }
}

function publicReaderStatus(status: SpeechDaemonStatus): SpeechDaemonStatus {
  const state = { ...status.state } as SpeechDaemonStatus['state'] & { chunkText?: string };
  delete state.chunkText;
  return { ...status, state };
}

function publicCacheStats(stats: { bytes: number; files: number; maxAgeMs: number; maxBytes: number }): {
  bytes: number;
  entries: number;
  maxAgeMs: number;
  maxBytes: number;
} {
  return { bytes: stats.bytes, entries: stats.files, maxAgeMs: stats.maxAgeMs, maxBytes: stats.maxBytes };
}

function allTtsCacheStats(home: string): { bytes: number; files: number; maxAgeMs: number; maxBytes: number } {
  const kokoro = kokoroTtsCacheStats(home);
  const pocket = pocketTtsCacheStats(home);
  return {
    bytes: kokoro.bytes + pocket.bytes,
    files: kokoro.files + pocket.files,
    maxAgeMs: Math.max(kokoro.maxAgeMs, POCKET_CACHE_MAX_AGE_MS),
    maxBytes: kokoro.maxBytes + POCKET_CACHE_MAX_BYTES,
  };
}

function httpStatus(error: unknown): number {
  const status = Number((error as { statusCode?: number } | undefined)?.statusCode);
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : 400;
}

function readBody(req: IncomingMessage, res: ServerResponse, done: (body: string) => void): void {
  const declaredLength = Number(req.headers['content-length']);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_JSON_BODY_BYTES) {
    sendJson(res, 413, { error: `Request body exceeds the ${MAX_JSON_BODY_BYTES}-byte limit.` });
    req.resume();
    return;
  }
  const chunks: Buffer[] = [];
  let bytes = 0;
  let rejected = false;
  req.on('data', (chunk) => {
    if (rejected) return;
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    bytes += buffer.length;
    if (bytes > MAX_JSON_BODY_BYTES) {
      rejected = true;
      chunks.length = 0;
      sendJson(res, 413, { error: `Request body exceeds the ${MAX_JSON_BODY_BYTES}-byte limit.` });
      return;
    }
    chunks.push(buffer);
  });
  req.on('end', () => {
    if (!rejected) done(Buffer.concat(chunks, bytes).toString('utf8'));
  });
  req.on('error', (err) => {
    if (!rejected && !res.writableEnded) sendJson(res, 400, { error: err.message });
  });
}

function parseJson<T>(body: string): T {
  try {
    return JSON.parse(body || '{}') as T;
  } catch {
    throw new Error('invalid JSON');
  }
}

function runJson(res: ServerResponse, operation: () => Promise<unknown> | unknown): void {
  Promise.resolve()
    .then(operation)
    .then((payload) => sendJson(res, 200, payload))
    .catch((error) => sendJson(res, httpStatus(error), { error: (error as Error).message }));
}

function runKokoro(res: ServerResponse, body: string, synthesize: Synthesizer, home: string): void {
  let input: { text?: string; voice?: string; rate?: number };
  try {
    input = JSON.parse(body || '{}');
  } catch {
    sendJson(res, 400, { error: 'invalid JSON' });
    return;
  }
  try {
    validateReaderText(input.text);
  } catch (err) {
    sendJson(res, httpStatus(err), { error: (err as Error).message });
    return;
  }
  const abort = speechAbortForResponse(res);
  synthesize(home, {
    engine: 'kokoro',
    text: input.text ?? '',
    voice: input.voice,
    rate: input.rate,
  }, { signal: abort.signal })
    .then((audio) => sendJson(res, 200, {
      cached: audio.cached,
      engine: 'kokoro',
      rate: audio.rate,
      url: audio.url,
      voice: audio.voice,
    }))
    .catch((err) => {
      if (abort.signal.aborted || res.destroyed) return;
      sendJson(res, httpStatus(err), { error: (err as Error).message });
    });
}

function speechAbortForResponse(res: ServerResponse): AbortController {
  const ctrl = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) ctrl.abort();
  });
  return ctrl;
}

function sendKokoroAudio(res: ServerResponse, file: string, home: string): void {
  return sendCachedAudio(res, file, kokoroTtsCacheDir(home), isKokoroTtsId);
}

function sendPocketAudio(res: ServerResponse, file: string, home: string): void {
  return sendCachedAudio(res, file, pocketTtsCacheDir(home), isPocketTtsId);
}

function sendCachedAudio(res: ServerResponse, file: string, dir: string, isValidId: (id: string) => boolean): void {
  const id = file.endsWith('.wav') ? file.slice(0, -4) : file;
  if (!isValidId(id)) {
    res.statusCode = 404;
    res.end('Not found');
    return;
  }
  const path = join(dir, `${id}.wav`);
  if (!existsSync(path) || !isValidKokoroCacheFile(path)) {
    res.statusCode = 404;
    res.end('Not found');
    return;
  }
  markKokoroCacheUsed(path);
  let fd: number;
  try {
    fd = openSync(path, 'r');
  } catch {
    res.statusCode = 404;
    res.end('Not found');
    return;
  }
  let stat: ReturnType<typeof fstatSync>;
  try {
    stat = fstatSync(fd);
  } catch {
    closeSync(fd);
    res.statusCode = 404;
    res.end('Not found');
    return;
  }
  res.statusCode = 200;
  res.setHeader('Content-Type', 'audio/wav');
  res.setHeader('Content-Length', String(stat.size));
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  const stream = createReadStream(path, { autoClose: true, fd });
  stream.on('error', () => {
    if (!res.headersSent) {
      res.statusCode = 500;
      res.end('Could not read cached audio');
    } else {
      res.destroy();
    }
  });
  stream.pipe(res);
}

function sendVoiceExportFile(res: ServerResponse, path: string, filename: string): void {
  let fd: number;
  try {
    fd = openSync(path, 'r');
  } catch {
    sendJson(res, 404, { error: 'Voice file is no longer available.' });
    return;
  }
  let stat: ReturnType<typeof fstatSync>;
  try {
    stat = fstatSync(fd);
  } catch {
    closeSync(fd);
    sendJson(res, 404, { error: 'Voice file is no longer available.' });
    return;
  }
  const fallback = filename.replace(/[^a-z0-9 ._-]+/gi, '').replace(/["\\]/g, '') || 'kokoro-reading.wav';
  res.statusCode = 200;
  res.setHeader('Content-Type', 'audio/wav');
  res.setHeader('Content-Length', String(stat.size));
  res.setHeader('Content-Disposition', `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const stream = createReadStream(path, { autoClose: true, fd });
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}

function sendHtml(res: ServerResponse, html: string): void {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; font-src 'self'; img-src 'self' data:; media-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.end(html);
}

function sendFont(res: ServerResponse, requestedFile: string): void {
  const file = FONT_ASSETS.get(requestedFile);
  if (!file) {
    res.statusCode = 404;
    res.end('Not found');
    return;
  }
  const path = join(PROJECT_ROOT, 'assets', 'fonts', file);
  if (!existsSync(path)) {
    res.statusCode = 404;
    res.end('Not found');
    return;
  }
  const body = readFileSync(path);
  res.statusCode = 200;
  res.setHeader('Content-Type', 'font/ttf');
  res.setHeader('Content-Length', String(body.length));
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.end(body);
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  if (res.writableEnded) return;
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(payload));
}

function installSignalCleanup(server: Server): () => void {
  let forceTimer: ReturnType<typeof setTimeout> | undefined;
  let removed = false;
  const shutdown = () => {
    if (!server.listening) return;
    server.close();
    server.closeIdleConnections();
    forceTimer ??= setTimeout(() => server.closeAllConnections(), 3000);
    forceTimer.unref?.();
  };
  const remove = () => {
    if (removed) return;
    removed = true;
    if (forceTimer) clearTimeout(forceTimer);
    process.removeListener('SIGINT', shutdown);
    process.removeListener('SIGTERM', shutdown);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  return remove;
}

function openBrowser(url: string): void {
  if (process.platform !== 'darwin') return;
  const child = spawn('open', [url], { detached: true, stdio: 'ignore' });
  child.unref();
}
