import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { renderPage } from './page.js';
import {
  isKokoroTtsId,
  kokoroTtsCacheDir,
  synthesizeWithKokoro,
  type KokoroTtsRequest,
  type KokoroTtsCacheEntry,
} from './kokoro-tts.js';

export interface ServeOptions {
  port?: number;
  open?: boolean;
  synthesize?: Synthesizer;
}

export type SynthResult = KokoroTtsCacheEntry & { cached: boolean; url: string };
export type Synthesizer = (home: string, input: KokoroTtsRequest, opts?: { signal?: AbortSignal }) => Promise<SynthResult>;

const DEFAULT_PORT = 7878;

export function serve(options: ServeOptions = {}): Server {
  const server = createServer((req, res) => handle(req, res, options.synthesize ?? synthesizeWithKokoro));
  const port = options.port ?? DEFAULT_PORT;
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${port} is in use. Try: npm run dev -- --port ${port + 1}`);
      process.exit(1);
    }
    console.error(`Server error: ${err.message}`);
    process.exit(1);
  });
  server.listen(port, () => {
    const addr = server.address();
    const actualPort = typeof addr === 'object' && addr ? addr.port : port;
    const url = `http://localhost:${actualPort}/`;
    console.log(`kokoro-reader ready -> ${url}`);
    if (options.open !== false) openBrowser(url);
  });
  return server;
}

export function handle(req: IncomingMessage, res: ServerResponse, synthesize: Synthesizer = synthesizeWithKokoro): void {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (req.method === 'GET' && url.pathname === '/') return sendHtml(res, renderPage());
  if (req.method === 'POST' && url.pathname === '/api/tts/kokoro') {
    return readBody(req, (body) => runKokoro(res, body, synthesize));
  }
  if (req.method === 'GET' && url.pathname.startsWith('/api/tts/kokoro/')) {
    return sendKokoroAudio(res, url.pathname.slice('/api/tts/kokoro/'.length));
  }
  res.statusCode = 404;
  res.end('Not found');
}

function readBody(req: IncomingMessage, done: (body: string) => void): void {
  let data = '';
  req.on('data', (chunk) => {
    data += chunk;
    if (data.length > 1_000_000) req.destroy();
  });
  req.on('end', () => done(data));
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
