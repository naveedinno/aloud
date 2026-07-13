import { spawn } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { homedir } from 'node:os';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createManagedKokoroSynthesizer, kokoroRate, kokoroVoiceLabel, kokoroVoiceOptions, normalizeKokoroVoice } from './kokoro-tts.js';
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
  playAudio,
  speechBatchesForMode,
  speechChunkRanges,
  speakText,
  speechPrefetchForMode,
  speechMode,
  type SpeechMode,
  type SpeechPlaybackHandle,
  type SpeechChunkRange,
  type SpeechResult,
} from './speak.js';

export const SPEECH_DAEMON_PORT = 17878;
const DAEMON_URL = `http://127.0.0.1:${SPEECH_DAEMON_PORT}`;
const RANDOM_VOICE = 'random';
const DAEMON_VOICES = kokoroVoiceOptions().map((voice) => voice.id);

export interface SpeechDaemonRequest {
  batch?: boolean;
  mode?: SpeechMode;
  prefetch?: number;
  rate?: number;
  text: string;
  voice?: string;
}

export type SpeechDaemonState = SpeechControllerState & {
  chunkEnd?: number;
  chunkStart?: number;
  chunkText?: string;
};

export interface SpeechDaemonStatus {
  accessibilityTrusted?: boolean;
  canGoNext: boolean;
  canGoPrevious: boolean;
  canReplay: boolean;
  mode: SpeechMode;
  modeLabel: string;
  ok: true;
  paused: boolean;
  rate: number;
  running: boolean;
  shortcut: GlobalShortcut;
  shortcutLabel: string;
  state: SpeechDaemonState;
  voice: string;
  voiceLabel: string;
}

export interface SpeechDaemonSettings {
  mode?: string;
  rate?: number;
  shortcut?: string;
  voice?: string;
}

export type SpeechDaemonControl = 'pause' | 'resume' | 'stop';
export type SpeechDaemonSeek = 'next' | 'previous' | 'replay';

export async function runSpeechDaemon(): Promise<void> {
  const home = homedir();
  const storedPreferences = loadReaderPreferences(home);
  const synthesizer = createManagedKokoroSynthesizer(home, { workers: 1 });
  const synthesize = (_home: string, input: Parameters<typeof synthesizer.synthesize>[0], opts?: Parameters<typeof synthesizer.synthesize>[1]) => synthesizer.synthesize(input, opts);
  let accessibilityTrusted: boolean | undefined;
  let currentAbort: AbortController | undefined;
  let currentChunks: string[] = [];
  let currentJob: Promise<void> | undefined;
  let currentMode: SpeechMode = speechMode(storedPreferences.mode ?? DEFAULT_READER_PREFERENCES.mode);
  let currentPaused = false;
  let currentPlayback: SpeechPlaybackHandle | undefined;
  let currentRate = kokoroRate(storedPreferences.rate ?? DEFAULT_READER_PREFERENCES.rate);
  let currentRequest: SpeechDaemonRequest | undefined;
  let currentShortcut = normalizeGlobalShortcut(storedPreferences.shortcut);
  let currentStartAt = 0;
  let currentVoice = normalizeDaemonVoice(storedPreferences.voice ?? DEFAULT_READER_PREFERENCES.voice);
  let currentState: SpeechDaemonState = { message: 'Ready', rate: currentRate, status: 'done' };

  const updateState = (state: Partial<SpeechDaemonState>) => {
    currentState = { ...currentState, ...state, rate: currentRate };
  };

  const persistPreferences = () => saveReaderPreferences(home, {
    mode: currentMode,
    rate: currentRate,
    shortcut: currentShortcut,
    voice: currentVoice,
  });

  const statusBody = (): SpeechDaemonStatus => {
    const currentIndex = activeChunkIndex(currentState.current, currentStartAt, currentChunks.length);
    return {
      accessibilityTrusted,
      canGoNext: currentChunks.length > 1 && currentIndex < currentChunks.length - 1,
      canGoPrevious: currentChunks.length > 1 && currentIndex > 0,
      canReplay: currentChunks.length > 0,
      mode: currentMode,
      modeLabel: speechModeLabel(currentMode),
      ok: true,
      paused: currentPaused,
      rate: currentRate,
      running: Boolean(currentAbort),
      shortcut: currentShortcut,
      shortcutLabel: globalShortcutLabel(currentShortcut),
      state: currentState,
      voice: currentVoice,
      voiceLabel: daemonVoiceLabel(currentVoice),
    };
  };

  const stopCurrent = () => {
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

  const startJob = (input: SpeechDaemonRequest, chunks: string[], startAt = 0) => {
    const abort = new AbortController();
    const chunkRanges = speechChunkRanges(input.text, chunks);
    currentPaused = false;
    currentRequest = input;
    currentChunks = chunks;
    currentStartAt = Math.max(0, Math.min(chunks.length - 1, startAt));
    const jobInput: SpeechDaemonRequest = {
      ...input,
      mode: currentMode,
      rate: currentRate,
      voice: selectedDaemonVoice(currentVoice),
    };
    const startRange = chunkRanges[currentStartAt];
    updateState({
      chunkEnd: startRange?.end,
      chunkStart: startRange?.start,
      chunkText: chunks[currentStartAt] ?? input.text,
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
      () => currentRate,
      updateState,
      (handle) => {
        currentPlayback = handle;
        if (currentPaused) currentPlayback?.pause();
      },
    );
    currentJob = job;
    void job.finally(() => {
      if (currentJob === job) {
        currentPaused = false;
        currentPlayback = undefined;
        currentAbort = undefined;
        currentJob = undefined;
      }
    });
  };

  const server = createServer(async (request, response) => {
    try {
      if (request.method === 'GET' && request.url === '/health') {
        return sendJson(response, { ok: true });
      }
      if (request.method === 'GET' && request.url === '/status') {
        return sendJson(response, statusBody());
      }
      if (request.method === 'POST' && request.url === '/settings') {
        const body = await readJson<SpeechDaemonSettings>(request);
        if (body.mode !== undefined) currentMode = speechMode(body.mode);
        if (body.rate !== undefined) currentRate = kokoroRate(body.rate);
        if (body.shortcut !== undefined) currentShortcut = normalizeGlobalShortcut(body.shortcut);
        if (body.voice !== undefined) currentVoice = normalizeDaemonVoice(body.voice);
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
        currentVoice = normalizeDaemonVoice(body.voice);
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
        stopCurrent();
        return sendJson(response, { ok: true, stopped: true });
      }
      if (request.method === 'POST' && request.url === '/pause') {
        pauseCurrent();
        return sendJson(response, { ok: true, paused: currentPaused });
      }
      if (request.method === 'POST' && request.url === '/resume') {
        resumeCurrent();
        return sendJson(response, { ok: true, paused: currentPaused });
      }
      if (request.method === 'POST' && request.url === '/seek') {
        const body = await readJson<{ action?: SpeechDaemonSeek }>(request);
        if (!currentRequest || currentChunks.length === 0) {
          return sendJson(response, { error: 'Nothing is available to navigate.', ok: false }, 409);
        }
        const currentIndex = activeChunkIndex(currentState.current, currentStartAt, currentChunks.length);
        const target = seekTarget(body.action, currentIndex, currentChunks.length);
        stopCurrent();
        await currentJob;
        startJob(currentRequest, currentChunks, target);
        return sendJson(response, statusBody());
      }
      if (request.method === 'POST' && request.url === '/speak') {
        const body = await readJson<SpeechDaemonRequest>(request);
        const text = String(body.text ?? '').trim();
        if (!text) return sendJson(response, { error: 'No text to speak.', ok: false }, 400);

        stopCurrent();
        await currentJob;
        currentMode = speechMode(body.mode ?? currentMode);
        currentRate = kokoroRate(body.rate ?? currentRate);
        currentVoice = normalizeDaemonVoice(body.voice ?? currentVoice);
        currentShortcut = normalizeGlobalShortcut(currentShortcut);
        persistPreferences();
        const chunks = body.batch === false ? [text] : speechBatchesForMode(text, currentMode);
        startJob({ ...body, text }, chunks, 0);
        return sendJson(response, statusBody());
      }
      response.writeHead(404).end();
    } catch (err) {
      sendJson(response, { error: (err as Error).message, ok: false }, 500);
    }
  });

  server.listen(SPEECH_DAEMON_PORT, '127.0.0.1');
  server.on('close', () => synthesizer.dispose());
}

export async function sendSpeakToDaemon(input: SpeechDaemonRequest): Promise<void> {
  await ensureSpeechDaemon();
  await postJson('/speak', input);
}

export async function stopSpeechDaemonPlayback(): Promise<void> {
  await postJson('/stop', {});
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
  rate: () => number,
  updateState: (state: Partial<SpeechDaemonState>) => void,
  onPlaybackHandle: (handle: SpeechPlaybackHandle | undefined) => void,
): Promise<void> {
  try {
    const result = await speakText({
      batch: input.batch,
      batches,
      home,
      mode: input.mode,
      onPlaybackHandle,
      onProgress: (progress) => {
        const range = chunkRanges[progress.index];
        const { index: _index, ...state } = progress;
        updateState({
          ...state,
          chunkEnd: range?.end,
          chunkStart: range?.start,
        });
      },
      player: playAudio,
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

async function ensureSpeechDaemon(): Promise<void> {
  if (await daemonHealthy()) return;
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
  try {
    await getJson('/health');
    return true;
  } catch {
    return false;
  }
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
        const text = Buffer.concat(chunks).toString('utf8');
        const json = text ? JSON.parse(text) as { error?: string; ok?: boolean } : {};
        if ((response.statusCode ?? 500) >= 400 || json.ok === false) reject(new Error(json.error ?? `Daemon request failed with status ${response.statusCode}.`));
        else resolve(json);
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
    request.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))));
    request.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as T);
      } catch (err) {
        reject(err);
      }
    });
    request.on('error', reject);
  });
}

function sendJson(response: ServerResponse, body: unknown, status = 200): void {
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(body));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeDaemonVoice(voice?: string): string {
  const value = String(voice ?? '').toLowerCase().trim().replace(/[\s-]+/g, '_');
  return value === RANDOM_VOICE ? RANDOM_VOICE : normalizeKokoroVoice(value);
}

function daemonVoiceLabel(voice?: string): string {
  return voice === RANDOM_VOICE ? 'Random' : kokoroVoiceLabel(voice);
}

function selectedDaemonVoice(voice?: string): string {
  if (voice !== RANDOM_VOICE) return normalizeKokoroVoice(voice);
  return DAEMON_VOICES[Math.floor(Math.random() * DAEMON_VOICES.length)] ?? normalizeKokoroVoice('af_heart');
}

function speechModeLabel(mode: SpeechMode): string {
  if (mode === 'auto') return 'Auto';
  return mode === 'smooth' ? 'Smooth Playback' : 'Fast Start';
}

function doneMessage(result: SpeechResult): string {
  return result.cached ? 'Finished from cache' : 'Finished reading';
}

function activeChunkIndex(current: number | undefined, startAt: number, total: number): number {
  if (total <= 0) return 0;
  const index = typeof current === 'number' && current > 0 ? current - 1 : startAt;
  return Math.max(0, Math.min(total - 1, index));
}

function seekTarget(action: SpeechDaemonSeek | undefined, current: number, total: number): number {
  if (action === 'previous') return Math.max(0, current - 1);
  if (action === 'next') return Math.min(Math.max(0, total - 1), current + 1);
  return current;
}
