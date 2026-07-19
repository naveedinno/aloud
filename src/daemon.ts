import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { homedir } from 'node:os';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { kokoroRate } from './kokoro-tts.js';
import type { SpeechControllerState } from './controller.js';
import {
  DEFAULT_READER_PREFERENCES,
  globalShortcutLabel,
  loadReaderPreferences,
  normalizeGlobalShortcut,
  saveReaderPreferences,
  type GlobalShortcut,
} from './preferences.js';
import {
  createManagedSpeechSynthesizer,
  engineVoiceLabel,
  engineVoiceOptions,
  normalizeEngineVoice,
  normalizeSpeechEngine,
  type SpeechEngine,
  type SpeechSynthesizer,
} from './speech-engine.js';
import {
  playAudio,
  speechBatchesForMode,
  speechChunkRanges,
  speakText,
  speechPrefetchForMode,
  speechMode,
  type SpeechMode,
  type SpeechPlaybackHandle,
  type SpeechPlayer,
  type SpeechChunkRange,
  type SpeechResult,
} from './speak.js';

export const SPEECH_DAEMON_PORT = 17878;
const DAEMON_URL = `http://127.0.0.1:${SPEECH_DAEMON_PORT}`;
const RANDOM_VOICE = 'random';
const MAX_DAEMON_BODY_BYTES = 2 * 1024 * 1024;
const MAX_DAEMON_TEXT_CHARACTERS = 240_000;
export const DAEMON_SERVICE = 'aloud-speech-daemon';
export const DAEMON_PROTOCOL = 2;

export interface SpeechDaemonRequest {
  batch?: boolean;
  engine?: SpeechEngine;
  mode?: SpeechMode;
  prefetch?: number;
  rate?: number;
  text: string;
  voice?: string;
}

export type SpeechDaemonState = SpeechControllerState & {
  chunkEnd?: number;
  chunkStart?: number;
};

export interface SpeechDaemonStatus {
  accessibilityTrusted?: boolean;
  canGoNext: boolean;
  canGoPrevious: boolean;
  canReplay: boolean;
  engine: SpeechEngine;
  engineLabel: string;
  mode: SpeechMode;
  modeLabel: string;
  jobId?: string;
  ok: true;
  paused: boolean;
  rate: number;
  running: boolean;
  shortcut: GlobalShortcut;
  shortcutLabel: string;
  service: typeof DAEMON_SERVICE;
  protocolVersion: typeof DAEMON_PROTOCOL;
  state: SpeechDaemonState;
  voice: string;
  voiceLabel: string;
}

export interface SpeechDaemonSettings {
  engine?: string;
  mode?: string;
  rate?: number;
  shortcut?: string;
  voice?: string;
}

export type SpeechDaemonControl = 'pause' | 'resume' | 'stop';
export type SpeechDaemonSeek = 'next' | 'previous' | 'replay';

export interface SpeechDaemonRunOptions {
  home?: string;
  host?: string;
  player?: SpeechPlayer;
  port?: number;
  signals?: boolean;
  synthesize?: SpeechSynthesizer;
}

export type SerializedExecutor = <T>(operation: () => Promise<T> | T) => Promise<T>;

export type SingleFlightOperation<T> = () => Promise<T>;

export function createSingleFlight<T>(operation: SingleFlightOperation<T>): SingleFlightOperation<T> {
  let inFlight: Promise<T> | undefined;
  return () => {
    if (inFlight) return inFlight;
    const next = operation();
    const shared = next.finally(() => {
      if (inFlight === shared) inFlight = undefined;
    });
    inFlight = shared;
    return shared;
  };
}

export function createSerializedExecutor(): SerializedExecutor {
  let tail = Promise.resolve<unknown>(undefined);
  return <T>(operation: () => Promise<T> | T): Promise<T> => {
    const result = tail.then(operation, operation);
    tail = result.then(() => undefined, () => undefined);
    return result;
  };
}

export async function runSpeechDaemon(options: SpeechDaemonRunOptions = {}): Promise<ReturnType<typeof createServer>> {
  const home = options.home ?? homedir();
  const storedPreferences = loadReaderPreferences(home);
  const synthesizer = options.synthesize ? undefined : createManagedSpeechSynthesizer(home);
  const synthesize: SpeechSynthesizer = options.synthesize
    ?? ((requestHome, input, opts) => synthesizer!.synthesize(requestHome, input, opts));
  const player = options.player ?? playAudio;
  const serializeMutation = createSerializedExecutor();
  let accessibilityTrusted: boolean | undefined;
  let currentAbort: AbortController | undefined;
  let currentChunks: string[] = [];
  let currentGeneration = 0;
  let currentChunkIndex = 0;
  let currentEngine = normalizeSpeechEngine(storedPreferences.engine ?? DEFAULT_READER_PREFERENCES.engine);
  let currentJob: Promise<void> | undefined;
  let currentJobId: string | undefined;
  let currentMode: SpeechMode = speechMode(storedPreferences.mode ?? DEFAULT_READER_PREFERENCES.mode);
  let currentPaused = false;
  let currentPlayback: SpeechPlaybackHandle | undefined;
  let currentRate = kokoroRate(storedPreferences.rate ?? DEFAULT_READER_PREFERENCES.rate);
  let currentRequest: SpeechDaemonRequest | undefined;
  let currentShortcut = normalizeGlobalShortcut(storedPreferences.shortcut);
  let currentStartAt = 0;
  let currentVoice = normalizeDaemonVoice(currentEngine, storedPreferences.voice ?? DEFAULT_READER_PREFERENCES.voice);
  let currentState: SpeechDaemonState = { message: 'Ready', rate: currentRate, status: 'done' };

  const updateState = (state: Partial<SpeechDaemonState>) => {
    currentState = { ...currentState, ...state, rate: currentRate };
  };

  const persistPreferences = () => saveReaderPreferences(home, {
    engine: currentEngine,
    mode: currentMode,
    rate: currentRate,
    shortcut: currentShortcut,
    voice: currentVoice,
  });

  const statusBody = (): SpeechDaemonStatus => {
    const currentIndex = Math.max(0, Math.min(Math.max(0, currentChunks.length - 1), currentChunkIndex));
    return {
      accessibilityTrusted,
      canGoNext: currentChunks.length > 1 && currentIndex < currentChunks.length - 1,
      canGoPrevious: currentChunks.length > 1 && currentIndex > 0,
      canReplay: currentChunks.length > 0,
      engine: currentEngine,
      engineLabel: currentEngine === 'pocket' ? 'Pocket TTS' : 'Kokoro',
      mode: currentMode,
      modeLabel: speechModeLabel(currentMode),
      jobId: currentJobId,
      ok: true,
      paused: currentPaused,
      rate: currentRate,
      running: Boolean(currentAbort),
      shortcut: currentShortcut,
      shortcutLabel: globalShortcutLabel(currentShortcut),
      service: DAEMON_SERVICE,
      protocolVersion: DAEMON_PROTOCOL,
      state: currentState,
      voice: currentVoice,
      voiceLabel: daemonVoiceLabel(currentEngine, currentVoice),
    };
  };

  const stopCurrent = () => {
    currentGeneration += 1;
    currentPlayback?.stop();
    currentAbort?.abort();
    currentPaused = false;
    currentPlayback = undefined;
    updateState({ message: 'Stopped', status: 'stopped' });
    currentAbort = undefined;
  };

  const pauseCurrent = () => {
    if (!currentAbort) return;
    currentPaused = true;
    currentPlayback?.pause();
    updateState({ message: 'Paused' });
  };

  const resumeCurrent = () => {
    currentPaused = false;
    currentPlayback?.resume();
    updateState({ message: currentAbort ? 'Reading selected text' : 'Ready' });
  };

  const startJob = (input: SpeechDaemonRequest, chunks: string[], startAt = 0, jobId: string = randomUUID()) => {
    const generation = ++currentGeneration;
    const abort = new AbortController();
    const chunkRanges = speechChunkRanges(input.text, chunks);
    currentPaused = false;
    currentRequest = input;
    currentJobId = jobId;
    currentChunks = chunks;
    currentStartAt = Math.max(0, Math.min(chunks.length - 1, startAt));
    currentChunkIndex = currentStartAt;
    const jobInput: SpeechDaemonRequest = {
      ...input,
      engine: currentEngine,
      mode: currentMode,
      rate: currentRate,
      voice: selectedDaemonVoice(currentEngine, currentVoice),
    };
    const startRange = chunkRanges[currentStartAt];
    updateState({
      chunkEnd: startRange?.end,
      chunkStart: startRange?.start,
      current: currentStartAt,
      message: chunks.length > 1 ? `Preparing chunk ${currentStartAt + 1} of ${chunks.length}` : 'Preparing selected text',
      status: 'starting',
      total: chunks.length,
    });
    currentAbort = abort;
    const job = speakDaemonJob(
      home,
      jobInput,
      chunks,
      chunkRanges,
      currentStartAt,
      abort,
      synthesize,
      player,
      () => currentRate,
      (state, chunkIndex) => {
        if (generation === currentGeneration) {
          if (typeof chunkIndex === 'number') currentChunkIndex = chunkIndex;
          updateState(state);
        }
      },
      (handle) => {
        if (generation !== currentGeneration) {
          handle?.stop();
          return;
        }
        currentPlayback = handle;
        if (currentPaused) currentPlayback?.pause();
      },
    );
    currentJob = job;
    void job.finally(() => {
      if (currentJob === job) {
        currentJob = undefined;
        if (generation === currentGeneration) {
          currentPaused = false;
          currentPlayback = undefined;
          currentAbort = undefined;
        }
      }
    });
  };

  const server = createServer(async (request, response) => {
    try {
      const requestError = daemonRequestError(request);
      if (requestError) return sendJson(response, { error: requestError.message, ok: false }, requestError.status);
      if (request.method === 'GET' && request.url === '/health') {
        return sendJson(response, { ok: true, protocolVersion: DAEMON_PROTOCOL, service: DAEMON_SERVICE });
      }
      if (request.method === 'GET' && request.url === '/status') {
        return sendJson(response, statusBody());
      }
      if (request.method === 'POST' && request.url === '/settings') {
        const body = await readJson<SpeechDaemonSettings>(request);
        if (body.engine !== undefined) {
          currentEngine = normalizeSpeechEngine(body.engine);
          currentVoice = normalizeDaemonVoice(currentEngine, undefined);
        }
        if (body.mode !== undefined) currentMode = speechMode(body.mode);
        if (body.rate !== undefined) currentRate = kokoroRate(body.rate);
        if (body.shortcut !== undefined) currentShortcut = normalizeGlobalShortcut(body.shortcut);
        if (body.voice !== undefined) currentVoice = normalizeDaemonVoice(currentEngine, body.voice);
        updateState({ rate: currentRate });
        persistPreferences();
        return sendJson(response, statusBody());
      }
      if (request.method === 'POST' && request.url === '/rate') {
        const body = await readJson<{ rate?: number }>(request);
        currentRate = kokoroRate(body.rate);
        updateState({ rate: currentRate });
        persistPreferences();
        return sendJson(response, statusBody());
      }
      if (request.method === 'POST' && request.url === '/voice') {
        const body = await readJson<{ voice?: string }>(request);
        currentVoice = normalizeDaemonVoice(currentEngine, body.voice);
        persistPreferences();
        return sendJson(response, statusBody());
      }
      if (request.method === 'POST' && request.url === '/mode') {
        const body = await readJson<{ mode?: string }>(request);
        currentMode = speechMode(body.mode);
        persistPreferences();
        return sendJson(response, statusBody());
      }
      if (request.method === 'POST' && request.url === '/shortcut') {
        const body = await readJson<{ shortcut?: string }>(request);
        currentShortcut = normalizeGlobalShortcut(body.shortcut);
        persistPreferences();
        return sendJson(response, statusBody());
      }
      if (request.method === 'POST' && request.url === '/accessibility') {
        const body = await readJson<{ trusted?: boolean }>(request);
        accessibilityTrusted = typeof body.trusted === 'boolean' ? body.trusted : undefined;
        return sendJson(response, statusBody());
      }
      if (request.method === 'POST' && request.url === '/stop') {
        await readJson<Record<string, never>>(request);
        return await serializeMutation(() => {
          stopCurrent();
          return sendJson(response, { ok: true, stopped: true });
        });
      }
      if (request.method === 'POST' && request.url === '/shutdown') {
        await readJson<Record<string, never>>(request);
        return await serializeMutation(async () => {
          stopCurrent();
          await currentJob;
          response.setHeader('Connection', 'close');
          response.once('finish', () => closeDaemonServer(server));
          return sendJson(response, { ok: true, stopped: true });
        });
      }
      if (request.method === 'POST' && request.url === '/pause') {
        await readJson<Record<string, never>>(request);
        return await serializeMutation(() => {
          pauseCurrent();
          return sendJson(response, { ok: true, paused: currentPaused });
        });
      }
      if (request.method === 'POST' && request.url === '/resume') {
        await readJson<Record<string, never>>(request);
        return await serializeMutation(() => {
          resumeCurrent();
          return sendJson(response, { ok: true, paused: currentPaused });
        });
      }
      if (request.method === 'POST' && request.url === '/seek') {
        const body = await readJson<{ action?: SpeechDaemonSeek }>(request);
        if (!body.action || !['next', 'previous', 'replay'].includes(body.action)) {
          return sendJson(response, { error: 'Unknown navigation action.', ok: false }, 400);
        }
        return await serializeMutation(async () => {
          if (!currentRequest || currentChunks.length === 0) {
            return sendJson(response, { error: 'Nothing is available to navigate.', ok: false }, 409);
          }
          const requestToReplay = currentRequest;
          const chunksToReplay = currentChunks;
          const jobIdToReplay = currentJobId ?? randomUUID();
          const currentIndex = currentChunkIndex;
          const target = seekTarget(body.action, currentIndex, currentChunks.length);
          stopCurrent();
          await currentJob;
          startJob(requestToReplay, chunksToReplay, target, jobIdToReplay);
          return sendJson(response, statusBody());
        });
      }
      if (request.method === 'POST' && request.url === '/speak') {
        const body = await readJson<SpeechDaemonRequest>(request);
        const text = String(body.text ?? '');
        if (!text.trim()) return sendJson(response, { error: 'No text to speak.', ok: false }, 400);
        if (text.length > MAX_DAEMON_TEXT_CHARACTERS) {
          return sendJson(response, { error: `Text is too long (${MAX_DAEMON_TEXT_CHARACTERS} characters max).`, ok: false }, 413);
        }

        return await serializeMutation(async () => {
          stopCurrent();
          await currentJob;
          currentMode = speechMode(body.mode ?? currentMode);
          currentEngine = normalizeSpeechEngine(body.engine ?? currentEngine);
          currentRate = kokoroRate(body.rate ?? currentRate);
          currentVoice = normalizeDaemonVoice(currentEngine, body.voice ?? currentVoice);
          currentShortcut = normalizeGlobalShortcut(currentShortcut);
          persistPreferences();
          const chunks = body.batch === false ? [text] : speechBatchesForMode(text, currentMode);
          startJob({ ...body, text }, chunks, 0);
          return sendJson(response, statusBody());
        });
      }
      response.writeHead(404).end();
    } catch (err) {
      sendJson(response, { error: (err as Error).message, ok: false }, httpStatus(err));
    }
  });

  const removeSignalHandlers = options.signals === false
    ? () => {}
    : installDaemonSignalCleanup(server, stopCurrent);
  server.on('close', () => {
    removeSignalHandlers();
    stopCurrent();
    synthesizer?.dispose();
  });
  await listen(server, options.port ?? SPEECH_DAEMON_PORT, options.host ?? '127.0.0.1');
  return server;
}

export async function sendSpeakToDaemon(input: SpeechDaemonRequest): Promise<SpeechDaemonStatus> {
  await ensureSpeechDaemon();
  return await postJson('/speak', input) as SpeechDaemonStatus;
}

export async function stopSpeechDaemonPlayback(): Promise<void> {
  if (!await daemonHealthy()) return;
  await postJson('/stop', {});
}

export async function shutdownSpeechDaemon(): Promise<boolean> {
  if (!await daemonHealthy()) return false;
  try {
    await postJson('/shutdown', {});
    return true;
  } catch (err) {
    if (['ECONNREFUSED', 'ECONNRESET'].includes(String((err as NodeJS.ErrnoException).code ?? ''))) return false;
    throw err;
  }
}

export async function getSpeechDaemonStatus(): Promise<SpeechDaemonStatus> {
  await ensureSpeechDaemon();
  return await getJson('/status') as SpeechDaemonStatus;
}

export async function configureSpeechDaemon(settings: SpeechDaemonSettings): Promise<SpeechDaemonStatus> {
  await ensureSpeechDaemon();
  return await postJson('/settings', settings) as SpeechDaemonStatus;
}

export async function controlSpeechDaemon(action: SpeechDaemonControl): Promise<unknown> {
  await ensureSpeechDaemon();
  return await postJson(`/${action}`, {});
}

export async function seekSpeechDaemon(action: SpeechDaemonSeek): Promise<SpeechDaemonStatus> {
  await ensureSpeechDaemon();
  return await postJson('/seek', { action }) as SpeechDaemonStatus;
}

async function speakDaemonJob(
  home: string,
  input: SpeechDaemonRequest,
  batches: string[],
  chunkRanges: Array<SpeechChunkRange | undefined>,
  startAt: number,
  abort: AbortController,
  synthesize: Parameters<typeof speakText>[0]['synthesize'],
  player: SpeechPlayer,
  rate: () => number,
  updateState: (state: Partial<SpeechDaemonState>, chunkIndex?: number) => void,
  onPlaybackHandle: (handle: SpeechPlaybackHandle | undefined) => void,
): Promise<void> {
  try {
    const result = await speakText({
      batch: input.batch,
      batches,
      home,
      mode: input.mode,
      engine: input.engine,
      onPlaybackHandle,
      onProgress: (progress) => {
        const range = chunkRanges[progress.index];
        const { chunkText: _chunkText, index: _index, ...state } = progress;
        updateState({
          ...state,
          chunkEnd: range?.end,
          chunkStart: range?.start,
        }, progress.index);
      },
      player,
      playbackRate: rate,
      prefetch: input.prefetch ?? speechPrefetchForMode(input.mode),
      rate: 1,
      signal: abort.signal,
      startAt,
      synthesize,
      text: input.text,
      voice: input.voice,
    });
    updateState({ message: doneMessage(result), status: 'done' });
  } catch (err) {
    updateState({
      message: (err as Error).name === 'AbortError' ? 'Stopped' : (err as Error).message,
      status: (err as Error).name === 'AbortError' ? 'stopped' : 'error',
    });
  }
}

const ensureSpeechDaemonStarted = createSingleFlight(startSpeechDaemon);

async function ensureSpeechDaemon(): Promise<void> {
  await ensureSpeechDaemonStarted();
}

async function startSpeechDaemon(): Promise<void> {
  const existingHealth = await daemonHealthResponse();
  if (isSpeechDaemonHealth(existingHealth)) return;
  if (existingHealth !== undefined) {
    throw new Error('An older or incompatible Aloud daemon is running. Restart Services from Mac connection to upgrade it safely.');
  }
  const cliPath = process.argv[1];
  const child = spawn(process.execPath, [cliPath, 'daemon'], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (await daemonHealthy()) return;
    await delay(100);
  }
  throw new Error('Kokoro speech daemon did not start.');
}

async function daemonHealthy(): Promise<boolean> {
  return isSpeechDaemonHealth(await daemonHealthResponse());
}

async function daemonHealthResponse(): Promise<unknown | undefined> {
  try {
    return await getJson('/health');
  } catch {
    return undefined;
  }
}

export function isSpeechDaemonHealth(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const health = value as { ok?: boolean; protocolVersion?: number; service?: string };
  return health.ok === true && health.protocolVersion === DAEMON_PROTOCOL && health.service === DAEMON_SERVICE;
}

function getJson(path: string): Promise<unknown> {
  return daemonRequest('GET', path);
}

function postJson(path: string, body: unknown): Promise<unknown> {
  return daemonRequest('POST', path, body);
}

function daemonRequest(method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const request = httpRequest(`${DAEMON_URL}${path}`, {
      headers: payload ? {
        'Content-Length': String(payload.length),
        'Content-Type': 'application/json',
      } : undefined,
      method,
      timeout: 1500,
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))));
      response.on('end', () => {
        try {
          const text = Buffer.concat(chunks).toString('utf8');
          if (!text) throw new Error('Kokoro speech daemon returned an empty response.');
          const json = JSON.parse(text) as { error?: string; ok?: boolean };
          if ((response.statusCode ?? 500) >= 400 || json.ok === false) reject(new Error(json.error ?? `Daemon request failed with status ${response.statusCode}.`));
          else resolve(json);
        } catch (err) {
          reject(err);
        }
      });
    });
    request.on('error', reject);
    request.on('timeout', () => {
      request.destroy(new Error('Kokoro speech daemon timed out.'));
    });
    if (payload) request.write(payload);
    request.end();
  });
}

function readJson<T>(request: IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    let settled = false;
    const declaredLength = Number(request.headers['content-length']);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_DAEMON_BODY_BYTES) {
      request.resume();
      reject(new DaemonHttpError(413, `Request body exceeds the ${MAX_DAEMON_BODY_BYTES}-byte limit.`));
      return;
    }
    request.on('data', (chunk) => {
      if (settled) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      bytes += buffer.length;
      if (bytes > MAX_DAEMON_BODY_BYTES) {
        settled = true;
        chunks.length = 0;
        reject(new DaemonHttpError(413, `Request body exceeds the ${MAX_DAEMON_BODY_BYTES}-byte limit.`));
        return;
      }
      chunks.push(buffer);
    });
    request.on('end', () => {
      if (settled) return;
      settled = true;
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as T);
      } catch {
        reject(new DaemonHttpError(400, 'invalid JSON'));
      }
    });
    request.on('error', (err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });
  });
}

function sendJson(response: ServerResponse, body: unknown, status = 200): void {
  if (response.writableEnded) return;
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(body));
}

class DaemonHttpError extends Error {
  constructor(readonly statusCode: number, message: string) {
    super(message);
    this.name = 'DaemonHttpError';
  }
}

function daemonRequestError(request: IncomingMessage): { message: string; status: number } | undefined {
  const host = request.headers.host;
  if (!host || !isLocalAuthority(host)) return { message: 'Only local requests are allowed.', status: 403 };
  if (request.method !== 'POST') return undefined;
  const fetchSite = request.headers['sec-fetch-site'];
  if (fetchSite && fetchSite !== 'same-origin') return { message: 'Cross-site requests are not allowed.', status: 403 };
  const originValue = request.headers.origin;
  if (originValue) {
    try {
      const origin = new URL(originValue);
      if (origin.protocol !== 'http:' || !isLocalAuthority(origin.host) || origin.host.toLowerCase() !== host.toLowerCase()) {
        return { message: 'The request origin is not allowed.', status: 403 };
      }
    } catch {
      return { message: 'The request origin is not allowed.', status: 403 };
    }
  }
  const contentType = String(request.headers['content-type'] ?? '').split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'application/json') {
    return { message: 'POST requests require Content-Type: application/json.', status: 415 };
  }
  return undefined;
}

function isLocalAuthority(value: string): boolean {
  try {
    const hostname = new URL(`http://${value}`).hostname.toLowerCase().replace(/\.$/, '');
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
  } catch {
    return false;
  }
}

function httpStatus(error: unknown): number {
  const status = Number((error as { statusCode?: number } | undefined)?.statusCode);
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500;
}

function listen(server: ReturnType<typeof createServer>, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (err: Error) => reject(err);
    server.once('error', onError);
    server.listen(port, host, () => {
      server.removeListener('error', onError);
      resolve();
    });
  });
}

function installDaemonSignalCleanup(server: ReturnType<typeof createServer>, stop: () => void): () => void {
  let forceTimer: ReturnType<typeof setTimeout> | undefined;
  let removed = false;
  const shutdown = () => {
    stop();
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

function closeDaemonServer(server: ReturnType<typeof createServer>): void {
  if (!server.listening) return;
  server.close();
  server.closeIdleConnections();
  const forceTimer = setTimeout(() => server.closeAllConnections(), 3000);
  forceTimer.unref?.();
  server.once('close', () => clearTimeout(forceTimer));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeDaemonVoice(engine: SpeechEngine, voice?: string): string {
  const value = String(voice ?? '').toLowerCase().trim().replace(/[\s-]+/g, '_');
  return value === RANDOM_VOICE ? RANDOM_VOICE : normalizeEngineVoice(engine, value);
}

function daemonVoiceLabel(engine: SpeechEngine, voice?: string): string {
  return voice === RANDOM_VOICE ? 'Random' : engineVoiceLabel(engine, voice);
}

function selectedDaemonVoice(engine: SpeechEngine, voice?: string): string {
  if (voice !== RANDOM_VOICE) return normalizeEngineVoice(engine, voice);
  const voices = engineVoiceOptions(engine);
  return voices[Math.floor(Math.random() * voices.length)]?.id ?? normalizeEngineVoice(engine);
}

function speechModeLabel(mode: SpeechMode): string {
  if (mode === 'auto') return 'Auto';
  return mode === 'smooth' ? 'Smooth Playback' : 'Fast Start';
}

function doneMessage(result: SpeechResult): string {
  return result.cached ? 'Finished from cache' : 'Finished reading';
}

function seekTarget(action: SpeechDaemonSeek | undefined, current: number, total: number): number {
  if (action === 'previous') return Math.max(0, current - 1);
  if (action === 'next') return Math.min(Math.max(0, total - 1), current + 1);
  return current;
}
