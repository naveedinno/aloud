import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  chmodSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import {
  isValidKokoroCacheFile,
  kokoroRate,
  aloudSupportDir,
  markKokoroCacheUsed,
} from './kokoro-tts.js';

export const POCKET_TTS_VERSION = '2.1.0';
export const POCKET_MAX_TEXT = 5000;
export const POCKET_IDLE_UNLOAD_MS = 20_000;
export const POCKET_CACHE_MAX_BYTES = 512 * 1024 * 1024;
export const POCKET_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const POCKET_CACHE_SCHEMA = 'pocket-tts-cache-v1';
const POCKET_WORKER_TIMEOUT_MS = 180_000;

const POCKET_WORKER_HELPER = String.raw`import json
import os
import sys

os.umask(0o077)

try:
    import numpy as np
    import scipy.io.wavfile
    from pocket_tts import TTSModel
except Exception as exc:
    print(json.dumps({
        "id": None,
        "ok": False,
        "error": "Pocket TTS is not installed. Run: npm run setup:aloud"
    }), flush=True)
    raise

model = TTSModel.load_model(language="english")
voices = {}

def voice_state(name):
    if name not in voices:
        voices[name] = model.get_state_for_audio_prompt(name)
    return voices[name]

for line in sys.stdin:
    request = None
    try:
        request = json.loads(line)
        audio = model.generate_audio(
            voice_state(request["voice"]),
            request["text"],
        )
        if hasattr(audio, "detach"):
            audio = audio.detach().cpu().numpy()
        audio = np.asarray(audio, dtype=np.float32).reshape(-1)
        if not audio.size:
            raise RuntimeError("Pocket TTS produced no audio.")
        pcm = (np.clip(audio, -1.0, 1.0) * 32767.0).astype(np.int16)
        scipy.io.wavfile.write(request["out_path"], model.sample_rate, pcm)
        print(json.dumps({"id": request["id"], "ok": True}), flush=True)
    except Exception as exc:
        print(json.dumps({
            "id": request.get("id") if isinstance(request, dict) else None,
            "ok": False,
            "error": str(exc)
        }), flush=True)
`;

export const POCKET_VOICES = {
  alba: { label: 'Alba', description: 'Natural, conversational English narrator.' },
  anna: { label: 'Anna', description: 'Clear English female voice.' },
  azelma: { label: 'Azelma', description: 'Expressive English female voice.' },
  bill_boerst: { label: 'Bill Boerst', description: 'Conversational English male voice.' },
  caro_davy: { label: 'Caro Davy', description: 'Natural English female voice.' },
  charles: { label: 'Charles', description: 'Clear English male voice.' },
  cosette: { label: 'Cosette', description: 'Expressive English female voice.' },
  eponine: { label: 'Éponine', description: 'Bright English female voice.' },
  eve: { label: 'Eve', description: 'Steady English female narrator.' },
  fantine: { label: 'Fantine', description: 'Warm English female voice.' },
  george: { label: 'George', description: 'Measured English male narrator.' },
  jane: { label: 'Jane', description: 'Clear English female narrator.' },
  javert: { label: 'Javert', description: 'Distinctive English male voice.' },
  jean: { label: 'Jean', description: 'Natural English male voice.' },
  marius: { label: 'Marius', description: 'Relaxed English male voice.' },
  mary: { label: 'Mary', description: 'Calm English female narrator.' },
  michael: { label: 'Michael', description: 'Steady English male voice.' },
  paul: { label: 'Paul', description: 'Conversational English male voice.' },
  peter_yearsley: { label: 'Peter Yearsley', description: 'Characterful English male voice.' },
  stuart_bell: { label: 'Stuart Bell', description: 'Direct English male narrator.' },
  vera: { label: 'Vera', description: 'Warm English female voice.' },
} as const;

export type PocketVoice = keyof typeof POCKET_VOICES;

export interface PocketTtsRequest {
  text: string;
  voice?: string;
  rate?: number;
}

export interface PocketTtsCacheEntry {
  dir: string;
  id: string;
  path: string;
  rate: number;
  voice: PocketVoice;
}

export interface PocketSynthesizerSession {
  synthesize(input: PocketTtsRequest, options?: { signal?: AbortSignal }): Promise<PocketTtsCacheEntry & { cached: boolean; url: string }>;
  dispose(): void;
}

export function pocketVoiceOptions(): Array<{ id: PocketVoice; label: string; description: string }> {
  return (Object.keys(POCKET_VOICES) as PocketVoice[]).map((id) => ({ id, ...POCKET_VOICES[id] }));
}

export function normalizePocketVoice(voice?: string): PocketVoice {
  const normalized = String(voice ?? '').toLowerCase().trim().replace(/[\s-]+/g, '_');
  return Object.prototype.hasOwnProperty.call(POCKET_VOICES, normalized)
    ? normalized as PocketVoice
    : 'alba';
}

export function pocketVoiceLabel(voice?: string): string {
  return POCKET_VOICES[normalizePocketVoice(voice)].label;
}

export function pocketTtsVenvDir(home: string): string {
  return join(aloudSupportDir(home), 'kokoro-venv');
}

export function pocketTtsCacheDir(home: string): string {
  return join(aloudSupportDir(home), 'tts-cache', 'pocket');
}

export function pocketTtsUrl(id: string): string {
  return `/api/tts/pocket/${id}.wav`;
}

export function isPocketTtsId(id: string): boolean {
  return /^[a-f0-9]{64}$/.test(id);
}

export function createManagedPocketSynthesizer(
  home: string,
  options: { command?: string; idleMs?: number; timeoutMs?: number } = {},
): PocketSynthesizerSession {
  const idleMs = Number.isFinite(options.idleMs) ? Math.max(0, Number(options.idleMs)) : POCKET_IDLE_UNLOAD_MS;
  const command = options.command ?? join(pocketTtsVenvDir(home), 'bin', 'python');
  const dir = pocketTtsCacheDir(home);
  const helper = ensurePocketWorkerHelper(dir);
  const worker = new PocketWorker(command, helper, options.timeoutMs ?? POCKET_WORKER_TIMEOUT_MS);
  let active = 0;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;

  const scheduleIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = undefined;
    if (active > 0) return;
    idleTimer = setTimeout(() => worker.unload(), idleMs);
    idleTimer.unref?.();
  };

  return {
    async synthesize(input, requestOptions = {}) {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = undefined;
      active += 1;
      try {
        const text = normalizePocketText(input.text);
        if (!text) throw new Error('No text to speak.');
        if (text.length > POCKET_MAX_TEXT) throw new Error(`Text is too long for Pocket TTS (${POCKET_MAX_TEXT} chars max).`);
        if (requestOptions.signal?.aborted) throw cancelled();
        const entry = pocketTtsCachePath(home, { ...input, text });
        if (isValidKokoroCacheFile(entry.path)) {
          markKokoroCacheUsed(entry.path);
          return { ...entry, cached: true, url: pocketTtsUrl(entry.id) };
        }
        mkdirSync(entry.dir, { mode: 0o700, recursive: true });
        const temporaryPath = `${entry.path}.${randomUUID()}.tmp`;
        try {
          await worker.run({ outputPath: temporaryPath, text, voice: entry.voice }, requestOptions.signal);
          if (!isValidKokoroCacheFile(temporaryPath)) throw new Error('Pocket TTS produced an invalid WAV file.');
          chmodSync(temporaryPath, 0o600);
          renameSync(temporaryPath, entry.path);
          prunePocketTtsCache(home);
          return { ...entry, cached: false, url: pocketTtsUrl(entry.id) };
        } finally {
          rmSync(temporaryPath, { force: true });
        }
      } finally {
        active -= 1;
        scheduleIdle();
      }
    },
    dispose() {
      if (idleTimer) clearTimeout(idleTimer);
      worker.dispose();
    },
  };
}

export function pocketTtsCacheStats(home: string): { bytes: number; files: number } {
  const files = pocketCacheFiles(home);
  return {
    bytes: files.reduce((sum, file) => sum + file.size, 0),
    files: files.length,
  };
}

export function clearPocketTtsCache(home: string): { bytes: number; files: number; removedBytes: number; removedFiles: number } {
  let removedBytes = 0;
  let removedFiles = 0;
  for (const file of pocketCacheFiles(home)) {
    try {
      rmSync(file.path, { force: true });
      removedBytes += file.size;
      removedFiles += 1;
    } catch {}
  }
  return { ...pocketTtsCacheStats(home), removedBytes, removedFiles };
}

function prunePocketTtsCache(home: string): void {
  const now = Date.now();
  let files = pocketCacheFiles(home).sort((a, b) => a.mtimeMs - b.mtimeMs);
  for (const file of files) {
    if (!isValidKokoroCacheFile(file.path) || now - file.mtimeMs > POCKET_CACHE_MAX_AGE_MS) {
      try { rmSync(file.path, { force: true }); } catch {}
    }
  }
  files = pocketCacheFiles(home).sort((a, b) => a.mtimeMs - b.mtimeMs);
  let bytes = files.reduce((sum, file) => sum + file.size, 0);
  for (const file of files) {
    if (bytes <= POCKET_CACHE_MAX_BYTES) break;
    try {
      rmSync(file.path, { force: true });
      bytes -= file.size;
    } catch {}
  }
}

function pocketCacheFiles(home: string): Array<{ mtimeMs: number; path: string; size: number }> {
  const dir = pocketTtsCacheDir(home);
  try {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      if (!entry.isFile() || !/^[a-f0-9]{64}\.wav$/.test(entry.name)) return [];
      const path = join(dir, entry.name);
      try {
        const stat = statSync(path);
        return [{ mtimeMs: stat.mtimeMs, path, size: stat.size }];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}

function normalizePocketText(text: string): string {
  return String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

function pocketTtsCachePath(home: string, input: PocketTtsRequest): PocketTtsCacheEntry {
  const text = normalizePocketText(input.text);
  const voice = normalizePocketVoice(input.voice);
  const rate = kokoroRate(input.rate);
  const id = createHash('sha256').update(JSON.stringify({
    engine: 'pocket',
    model: `pocket-tts-${POCKET_TTS_VERSION}-english`,
    schema: POCKET_CACHE_SCHEMA,
    text,
    voice,
  })).digest('hex');
  const dir = pocketTtsCacheDir(home);
  return { dir, id, path: join(dir, `${id}.wav`), rate, voice };
}

function ensurePocketWorkerHelper(dir: string): string {
  mkdirSync(dir, { mode: 0o700, recursive: true });
  const path = join(dir, 'pocket_worker.py');
  writeFileSync(path, POCKET_WORKER_HELPER, { encoding: 'utf8', mode: 0o600 });
  chmodSync(path, 0o600);
  return path;
}

class PocketWorker {
  private child?: ChildProcessWithoutNullStreams;
  private disposed = false;
  private stderr = '';
  private stdout = '';
  private pending = new Map<string, {
    reject: (error: Error) => void;
    resolve: () => void;
    timer: ReturnType<typeof setTimeout>;
  }>();

  constructor(
    private readonly command: string,
    private readonly helper: string,
    private readonly timeoutMs: number,
  ) {}

  run(input: { outputPath: string; text: string; voice: PocketVoice }, signal?: AbortSignal): Promise<void> {
    if (this.disposed) throw new Error('Pocket TTS synthesizer is unavailable.');
    if (signal?.aborted) return Promise.reject(cancelled());
    const child = this.ensureChild();
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.failAll(new Error('Pocket TTS speech generation timed out.'));
        this.stopChild();
      }, this.timeoutMs);
      timer.unref?.();
      const onAbort = () => {
        this.failAll(cancelled());
        this.stopChild();
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.pending.set(id, {
        reject: (error) => {
          signal?.removeEventListener('abort', onAbort);
          reject(error);
        },
        resolve: () => {
          signal?.removeEventListener('abort', onAbort);
          resolve();
        },
        timer,
      });
      child.stdin.write(`${JSON.stringify({
        id,
        out_path: input.outputPath,
        text: input.text,
        voice: input.voice,
      })}\n`);
    });
  }

  dispose(): void {
    this.disposed = true;
    this.failAll(cancelled());
    this.stopChild();
  }

  unload(): void {
    if (this.disposed) return;
    this.failAll(cancelled());
    this.stopChild();
  }

  private ensureChild(): ChildProcessWithoutNullStreams {
    if (this.child && !this.child.killed) return this.child;
    this.stderr = '';
    this.stdout = '';
    const child = spawn(this.command, [this.helper], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.child = child;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => this.consumeStdout(chunk));
    child.stderr.on('data', (chunk: string) => {
      this.stderr = `${this.stderr}${chunk}`.slice(-16_384);
    });
    child.on('error', (error) => {
      if (this.child !== child) return;
      this.child = undefined;
      this.failAll(pocketUnavailable(error.message));
    });
    child.on('close', (code, signal) => {
      if (this.child !== child) return;
      this.child = undefined;
      const exitDetail = signal
        ? `Worker exited after receiving ${signal}.`
        : `Worker exited with status ${code ?? 'unknown'}.`;
      if (this.pending.size) this.failAll(pocketUnavailable(this.stderr.trim() || exitDetail));
    });
    return child;
  }

  private consumeStdout(chunk: string): void {
    this.stdout += chunk;
    let newline = this.stdout.indexOf('\n');
    while (newline >= 0) {
      const line = this.stdout.slice(0, newline).trim();
      this.stdout = this.stdout.slice(newline + 1);
      if (line) {
        try {
          const result = JSON.parse(line) as { error?: string; id?: string; ok?: boolean };
          const pending = result.id ? this.pending.get(result.id) : undefined;
          if (pending) {
            clearTimeout(pending.timer);
            this.pending.delete(result.id!);
            if (result.ok) pending.resolve();
            else pending.reject(new Error(result.error || 'Pocket TTS generation failed.'));
          } else if (result.ok === false && !result.id) {
            this.failAll(pocketUnavailable(result.error || this.stderr.trim()));
          }
        } catch {}
      }
      newline = this.stdout.indexOf('\n');
    }
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private stopChild(): void {
    const child = this.child;
    this.child = undefined;
    child?.kill('SIGTERM');
  }
}

function pocketUnavailable(detail: string): Error {
  const suffix = detail ? ` ${detail}` : '';
  return new Error(`Pocket TTS is unavailable. Run: npm run setup:aloud.${suffix}`);
}

function cancelled(): Error {
  const error = new Error('Speech generation cancelled.');
  error.name = 'AbortError';
  return error;
}
