import { spawn } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { homedir } from 'node:os';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createKokoroSynthesizerSession, kokoroRate, kokoroVoiceLabel, kokoroVoiceOptions, normalizeKokoroVoice } from './kokoro-tts.js';
import type { SpeechControllerState } from './controller.js';
import { playAudio, speakText, speechMode, type SpeechMode, type SpeechPlaybackHandle, type SpeechResult } from './speak.js';

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

export async function runSpeechDaemon(): Promise<void> {
  const home = homedir();
  const session = createKokoroSynthesizerSession(home, { workers: 3 });
  const synthesize = (_home: string, input: Parameters<typeof session.synthesize>[0], opts?: Parameters<typeof session.synthesize>[1]) => session.synthesize(input, opts);
  let currentAbort: AbortController | undefined;
  let currentMode: SpeechMode = 'auto';
  let currentPaused = false;
  let currentPlayback: SpeechPlaybackHandle | undefined;
  let currentRate = 1;
  let currentVoice = normalizeDaemonVoice('af_heart');
  let currentState: SpeechControllerState = { message: 'Ready', rate: currentRate, status: 'done' };

  const updateState = (state: Partial<SpeechControllerState>) => {
    currentState = { ...currentState, ...state, rate: currentRate };
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

  const server = createServer(async (request, response) => {
    try {
      if (request.method === 'GET' && request.url === '/health') {
        return sendJson(response, { ok: true });
      }
      if (request.method === 'GET' && request.url === '/status') {
        return sendJson(response, {
          ok: true,
          mode: currentMode,
          modeLabel: speechModeLabel(currentMode),
          paused: currentPaused,
          rate: currentRate,
          running: Boolean(currentAbort),
          state: currentState,
          voice: currentVoice,
          voiceLabel: daemonVoiceLabel(currentVoice),
        });
      }
      if (request.method === 'POST' && request.url === '/rate') {
        const body = await readJson<{ rate?: number }>(request);
        currentRate = kokoroRate(body.rate);
        updateState({ rate: currentRate });
        return sendJson(response, {
          ok: true,
          mode: currentMode,
          modeLabel: speechModeLabel(currentMode),
          paused: currentPaused,
          rate: currentRate,
          running: Boolean(currentAbort),
          state: currentState,
          voice: currentVoice,
          voiceLabel: daemonVoiceLabel(currentVoice),
        });
      }
      if (request.method === 'POST' && request.url === '/voice') {
        const body = await readJson<{ voice?: string }>(request);
        currentVoice = normalizeDaemonVoice(body.voice);
        return sendJson(response, {
          ok: true,
          mode: currentMode,
          modeLabel: speechModeLabel(currentMode),
          paused: currentPaused,
          rate: currentRate,
          running: Boolean(currentAbort),
          state: currentState,
          voice: currentVoice,
          voiceLabel: daemonVoiceLabel(currentVoice),
        });
      }
      if (request.method === 'POST' && request.url === '/mode') {
        const body = await readJson<{ mode?: string }>(request);
        currentMode = speechMode(body.mode);
        return sendJson(response, {
          ok: true,
          mode: currentMode,
          modeLabel: speechModeLabel(currentMode),
          paused: currentPaused,
          rate: currentRate,
          running: Boolean(currentAbort),
          state: currentState,
          voice: currentVoice,
          voiceLabel: daemonVoiceLabel(currentVoice),
        });
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
      if (request.method === 'POST' && request.url === '/speak') {
        const body = await readJson<SpeechDaemonRequest>(request);
        const text = String(body.text ?? '').trim();
        if (!text) return sendJson(response, { error: 'No text to speak.', ok: false }, 400);

        stopCurrent();
        const abort = new AbortController();
        currentPaused = false;
        currentMode = speechMode(body.mode ?? currentMode);
        currentRate = kokoroRate(body.rate ?? currentRate);
        currentVoice = normalizeDaemonVoice(body.voice ?? currentVoice);
        const jobInput: SpeechDaemonRequest = { ...body, mode: currentMode, voice: selectedDaemonVoice(currentVoice) };
        updateState({ current: 0, message: 'Preparing selected text', status: 'starting', total: undefined });
        currentAbort = abort;
        void speakDaemonJob(
          home,
          jobInput,
          abort,
          synthesize,
          () => currentRate,
          updateState,
          (handle) => {
            currentPlayback = handle;
            if (currentPaused) currentPlayback?.pause();
          },
          () => {
            currentPaused = false;
            currentPlayback = undefined;
            currentAbort = undefined;
          });
        return sendJson(response, { ok: true });
      }
      response.writeHead(404).end();
    } catch (err) {
      sendJson(response, { error: (err as Error).message, ok: false }, 500);
    }
  });

  server.listen(SPEECH_DAEMON_PORT, '127.0.0.1');
  void warmKokoroWorkers(home, synthesize);
}

export async function sendSpeakToDaemon(input: SpeechDaemonRequest): Promise<void> {
  await ensureSpeechDaemon();
  await postJson('/speak', input);
}

export async function stopSpeechDaemonPlayback(): Promise<void> {
  await postJson('/stop', {});
}

async function speakDaemonJob(
  home: string,
  input: SpeechDaemonRequest,
  abort: AbortController,
  synthesize: Parameters<typeof speakText>[0]['synthesize'],
  rate: () => number,
  updateState: (state: Partial<SpeechControllerState>) => void,
  onPlaybackHandle: (handle: SpeechPlaybackHandle | undefined) => void,
  onDone: () => void,
): Promise<void> {
  try {
    const result = await speakText({
      batch: input.batch,
      home,
      mode: input.mode,
      onPlaybackHandle,
      onProgress: (progress) => updateState(progress),
      player: playAudio,
      playbackRate: rate,
      prefetch: input.prefetch,
      rate: 1,
      signal: abort.signal,
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
  } finally {
    onDone();
  }
}

async function warmKokoroWorkers(
  home: string,
  synthesize: NonNullable<Parameters<typeof speakText>[0]['synthesize']>,
): Promise<void> {
  const warmups = Array.from({ length: 3 }, (_, i) => synthesize(home, {
    rate: 1,
    text: `Kokoro warmup ${Date.now()} ${i}.`,
    voice: 'af_heart',
  }).catch(() => undefined));
  await Promise.all(warmups);
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
