import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { renderPage } from './page.js';
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
  createManagedKokoroSynthesizer,
  isKokoroTtsId,
  kokoroTtsCacheDir,
  synthesizeWithKokoro,
  type KokoroTtsRequest,
  type KokoroTtsCacheEntry,
} from './kokoro-tts.js';
import { splitTextIntoSpeechBatches } from './speak.js';
import {
  readerSystemHealth,
  runSystemRepair,
  type ReaderSystemHealth,
  type SystemRepairAction,
} from './system-health.js';

export interface ServeOptions {
  port?: number;
  open?: boolean;
  reader?: ReaderBackend;
  synthesize?: Synthesizer;
  system?: SystemBackend;
}

export type SynthResult = KokoroTtsCacheEntry & { cached: boolean; url: string };
export type Synthesizer = (home: string, input: KokoroTtsRequest, opts?: { signal?: AbortSignal }) => Promise<SynthResult>;

export interface ReaderBackend {
  control(action: SpeechDaemonControl): Promise<unknown>;
  seek(action: SpeechDaemonSeek): Promise<SpeechDaemonStatus>;
  settings(input: SpeechDaemonSettings): Promise<SpeechDaemonStatus>;
  speak(input: SpeechDaemonRequest): Promise<void>;
  status(): Promise<SpeechDaemonStatus>;
}

export interface SystemBackend {
  health(status?: SpeechDaemonStatus): ReaderSystemHealth;
  repair(action: SystemRepairAction): { message: string; started: boolean };
}

const DEFAULT_PORT = 7878;
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
  const managed = options.synthesize ? undefined : createManagedKokoroSynthesizer(homedir(), { workers: 1 });
  const synthesize = options.synthesize ?? ((_home: string, input: KokoroTtsRequest, opts?: { signal?: AbortSignal }) => managed!.synthesize(input, opts));
  const server = createServer((req, res) => handle(
    req,
    res,
    synthesize,
    options.reader ?? daemonReader,
    options.system ?? localSystem,
  ));
  const port = options.port ?? DEFAULT_PORT;
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${port} is in use. Try: npm run dev -- --port ${port + 1}`);
      process.exit(1);
    }
    console.error(`Server error: ${err.message}`);
    process.exit(1);
  });
  server.on('close', () => managed?.dispose());
  server.listen(port, () => {
    const addr = server.address();
    const actualPort = typeof addr === 'object' && addr ? addr.port : port;
    const url = `http://localhost:${actualPort}/`;
    console.log(`kokoro-reader ready -> ${url}`);
    if (options.open !== false) openBrowser(url);
  });
  return server;
}

export function handle(
  req: IncomingMessage,
  res: ServerResponse,
  synthesize: Synthesizer = synthesizeWithKokoro,
  reader: ReaderBackend = daemonReader,
  system: SystemBackend = localSystem,
): void {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (req.method === 'GET' && url.pathname === '/') return sendHtml(res, renderPage());
  if (req.method === 'GET' && url.pathname.startsWith('/assets/fonts/')) {
    return sendFont(res, url.pathname.slice('/assets/fonts/'.length));
  }
  if (req.method === 'GET' && url.pathname === '/api/reader/status') {
    return runJson(res, () => reader.status());
  }
  if (req.method === 'POST' && url.pathname === '/api/reader/settings') {
    return readBody(req, (body) => runJson(res, () => reader.settings(parseJson<SpeechDaemonSettings>(body))));
  }
  if (req.method === 'POST' && url.pathname === '/api/reader/speak') {
    return readBody(req, (body) => runJson(res, async () => {
      const input = parseJson<SpeechDaemonRequest>(body);
      await reader.speak(input);
      return reader.status();
    }));
  }
  if (req.method === 'POST' && url.pathname === '/api/reader/control') {
    return readBody(req, (body) => runJson(res, async () => {
      const { action } = parseJson<{ action?: SpeechDaemonControl }>(body);
      if (!action || !['pause', 'resume', 'stop'].includes(action)) throw new Error('Unknown playback action.');
      await reader.control(action);
      return reader.status();
    }));
  }
  if (req.method === 'POST' && url.pathname === '/api/reader/seek') {
    return readBody(req, (body) => runJson(res, () => {
      const { action } = parseJson<{ action?: SpeechDaemonSeek }>(body);
      if (!action || !['next', 'previous', 'replay'].includes(action)) throw new Error('Unknown navigation action.');
      return reader.seek(action);
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
    return readBody(req, (body) => runJson(res, async () => {
      const { action } = parseJson<{ action?: SystemRepairAction }>(body);
      if (!action || !['accessibility', 'kokoro', 'services'].includes(action)) throw new Error('Unknown setup action.');
      return system.repair(action);
    }));
  }
  if (req.method === 'POST' && url.pathname === '/api/tts/kokoro') {
    return readBody(req, (body) => runKokoro(res, body, synthesize));
  }
  if (req.method === 'POST' && url.pathname === '/api/tts/kokoro/plan') {
    return readBody(req, (body) => planKokoroSpeech(res, body));
  }
  if (req.method === 'GET' && url.pathname.startsWith('/api/tts/kokoro/')) {
    return sendKokoroAudio(res, url.pathname.slice('/api/tts/kokoro/'.length));
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
  const batches = splitTextIntoSpeechBatches(input.text ?? '');
  if (batches.length === 0) {
    sendJson(res, 400, { error: 'No text to speak.' });
    return;
  }
  sendJson(res, 200, { batches });
}

function readBody(req: IncomingMessage, done: (body: string) => void): void {
  let data = '';
  req.on('data', (chunk) => {
    data += chunk;
    if (data.length > 1_000_000) req.destroy();
  });
  req.on('end', () => done(data));
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
    .catch((error) => sendJson(res, 400, { error: (error as Error).message }));
}

function runKokoro(res: ServerResponse, body: string, synthesize: Synthesizer): void {
  let input: { text?: string; voice?: string; rate?: number };
  try {
    input = JSON.parse(body || '{}');
  } catch {
    sendJson(res, 400, { error: 'invalid JSON' });
    return;
  }
  const abort = speechAbortForResponse(res);
  synthesize(homedir(), {
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
      sendJson(res, 400, { error: (err as Error).message });
    });
}

function speechAbortForResponse(res: ServerResponse): AbortController {
  const ctrl = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) ctrl.abort();
  });
  return ctrl;
}

function sendKokoroAudio(res: ServerResponse, file: string): void {
  const id = file.endsWith('.wav') ? file.slice(0, -4) : file;
  if (!isKokoroTtsId(id)) {
    res.statusCode = 404;
    res.end('Not found');
    return;
  }
  const path = join(kokoroTtsCacheDir(homedir()), `${id}.wav`);
  if (!existsSync(path)) {
    res.statusCode = 404;
    res.end('Not found');
    return;
  }
  const stat = statSync(path);
  res.statusCode = 200;
  res.setHeader('Content-Type', 'audio/wav');
  res.setHeader('Content-Length', String(stat.size));
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  createReadStream(path).pipe(res);
}

function sendHtml(res: ServerResponse, html: string): void {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
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
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function openBrowser(url: string): void {
  if (process.platform !== 'darwin') return;
  const child = spawn('open', [url], { detached: true, stdio: 'ignore' });
  child.unref();
}
