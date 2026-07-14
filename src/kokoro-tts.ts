import { spawn, type ChildProcess, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

export const KOKORO_MAX_TEXT = 5000;
export const KOKORO_CACHE_SCHEMA = 'kokoro-82m-cache-v2';
export const KOKORO_CACHE_MAX_BYTES = 512 * 1024 * 1024;
export const KOKORO_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export const KOKORO_CACHE_CLEAR_GRACE_MS = 0;
export const KOKORO_MAX_QUEUE_PER_WORKER = 8;
export const KOKORO_WORKER_TIMEOUT_MS = 180_000;
const DEFAULT_PYTHON = 'python3';
const KOKORO_MODEL_ID = 'hexgrad/Kokoro-82M';
const KOKORO_MIN_WAV_BYTES = 44;
const MAX_PROCESS_OUTPUT_BYTES = 16 * 1024;
const MAX_WORKER_LINE_BYTES = 64 * 1024;
const STALE_TEMP_FILE_MS = 60 * 60 * 1000;
const WORKER_KILL_GRACE_MS = 2000;
const ACTIVE_CACHE_PATHS = new Map<string, number>();
const KOKORO_HELPER = String.raw`import os
import sys

os.umask(0o077)

out_path = sys.argv[1]
voice = sys.argv[2]
speed = float(sys.argv[3])
lang_code = sys.argv[4]
text = sys.stdin.read().strip()
device = os.environ.get("KOKORO_READER_DEVICE", os.environ.get("DIFFSTORY_KOKORO_DEVICE", "cpu")) or None

try:
    from kokoro import KPipeline
    import numpy as np
    import soundfile as sf
    import torch
except Exception as exc:
    raise RuntimeError(
        'Kokoro is not installed. Run: npm run setup:kokoro'
    ) from exc

pipeline = KPipeline(lang_code=lang_code, repo_id="hexgrad/Kokoro-82M", device=device)
chunks = []
with torch.inference_mode():
    for result in pipeline(text, voice=voice, speed=speed, split_pattern=r'\n+'):
        audio = result[2] if isinstance(result, tuple) else getattr(result, 'audio', None)
        if audio is None:
            continue
        if hasattr(audio, 'detach'):
            audio = audio.detach().cpu().numpy()
        else:
            audio = np.asarray(audio)
        chunks.append(audio)

if not chunks:
    raise RuntimeError('Kokoro produced no audio.')

audio = chunks[0] if len(chunks) == 1 else np.concatenate(chunks)
sf.write(out_path, audio, 24000)
`;
const KOKORO_WORKER_HELPER = String.raw`import json
import os
import sys

os.umask(0o077)

try:
    from kokoro import KPipeline
    import numpy as np
    import soundfile as sf
    import torch
except Exception as exc:
    print(json.dumps({
        "id": None,
        "ok": False,
        "error": 'Kokoro is not installed. Run: npm run setup:kokoro'
    }), flush=True)
    raise

pipelines = {}
shared_model = None
device = os.environ.get("KOKORO_READER_DEVICE", os.environ.get("DIFFSTORY_KOKORO_DEVICE", "cpu")) or None

def pipeline_for(lang_code):
    global shared_model
    if lang_code not in pipelines:
        pipelines[lang_code] = KPipeline(
            lang_code=lang_code,
            repo_id="hexgrad/Kokoro-82M",
            model=shared_model if shared_model is not None else True,
            device=device
        )
        shared_model = pipelines[lang_code].model
    return pipelines[lang_code]

def synthesize(request):
    pipeline = pipeline_for(request["lang_code"])
    chunks = []
    with torch.inference_mode():
        for result in pipeline(request["text"], voice=request["voice"], speed=float(request["speed"]), split_pattern=r'\n+'):
            audio = result[2] if isinstance(result, tuple) else getattr(result, 'audio', None)
            if audio is None:
                continue
            if hasattr(audio, 'detach'):
                audio = audio.detach().cpu().numpy()
            else:
                audio = np.asarray(audio)
            chunks.append(audio)
    if not chunks:
        raise RuntimeError('Kokoro produced no audio.')
    audio = chunks[0] if len(chunks) == 1 else np.concatenate(chunks)
    sf.write(request["out_path"], audio, 24000)

for line in sys.stdin:
    request = None
    try:
        request = json.loads(line)
        synthesize(request)
        print(json.dumps({"id": request["id"], "ok": True}), flush=True)
    except Exception as exc:
        print(json.dumps({"id": request.get("id") if isinstance(request, dict) else None, "ok": False, "error": str(exc)}), flush=True)
`;

export interface KokoroTtsRequest {
  text: string;
  voice?: string;
  rate?: number;
}

export interface KokoroTtsCacheEntry {
  dir: string;
  id: string;
  path: string;
  voice: KokoroVoice;
  langCode: KokoroLangCode;
  rate: number;
}

export interface KokoroSynthesizerSession {
  synthesize(input: KokoroTtsRequest, opts?: { signal?: AbortSignal }): Promise<KokoroTtsCacheEntry & { cached: boolean; url: string }>;
  dispose(): void;
}

export type ManagedKokoroSynthesizer = KokoroSynthesizerSession;

export interface KokoroCacheStats {
  bytes: number;
  files: number;
  maxAgeMs: number;
  maxBytes: number;
}

export interface KokoroCacheClearResult extends KokoroCacheStats {
  removedBytes: number;
  removedFiles: number;
}

export class KokoroCapacityError extends Error {
  readonly statusCode = 429;

  constructor(message = 'Kokoro is busy. Wait for the current speech request and try again.') {
    super(message);
    this.name = 'KokoroCapacityError';
  }
}

export class KokoroTimeoutError extends Error {
  readonly statusCode = 504;

  constructor(message = 'Kokoro speech generation timed out.') {
    super(message);
    this.name = 'KokoroTimeoutError';
  }
}

interface SharedSynthesis<T> {
  consumers: number;
  controller: AbortController;
  promise: Promise<T>;
  settled: boolean;
}

const ONE_SHOT_SYNTHESIS = new Map<string, SharedSynthesis<KokoroTtsCacheEntry & { cached: boolean; url: string }>>();

export const KOKORO_IDLE_UNLOAD_MS = 20_000;

export const KOKORO_VOICES = {
  af_heart: { label: 'Heart', description: 'Warm American female narrator.', langCode: 'a' },
  af_bella: { label: 'Bella', description: 'Clear American female voice.', langCode: 'a' },
  af_nicole: { label: 'Nicole', description: 'Calm American female voice.', langCode: 'a' },
  af_sarah: { label: 'Sarah', description: 'Steady American female voice.', langCode: 'a' },
  am_adam: { label: 'Adam', description: 'Natural American male voice.', langCode: 'a' },
  am_onyx: { label: 'Onyx', description: 'Deeper American male voice.', langCode: 'a' },
  bf_emma: { label: 'Emma', description: 'British female narrator.', langCode: 'b' },
  bm_daniel: { label: 'Daniel', description: 'British male narrator.', langCode: 'b' },
} as const;

export type KokoroVoice = keyof typeof KOKORO_VOICES;
export type KokoroLangCode = (typeof KOKORO_VOICES)[KokoroVoice]['langCode'];

const KOKORO_ALIASES: Record<string, KokoroVoice> = {
  heart: 'af_heart',
  bella: 'af_bella',
  nicole: 'af_nicole',
  sarah: 'af_sarah',
  adam: 'am_adam',
  onyx: 'am_onyx',
  emma: 'bf_emma',
  daniel: 'bm_daniel',
};

function isKokoroVoice(voice: string): voice is KokoroVoice {
  return Object.prototype.hasOwnProperty.call(KOKORO_VOICES, voice);
}

export function normalizeKokoroVoice(voice?: string): KokoroVoice {
  const v = String(voice ?? '').toLowerCase().trim().replace(/[\s-]+/g, '_');
  if (isKokoroVoice(v)) return v;
  return KOKORO_ALIASES[v] ?? 'af_heart';
}

export function kokoroVoiceOptions(): Array<{ id: KokoroVoice; label: string; description: string; langCode: KokoroLangCode }> {
  return (Object.keys(KOKORO_VOICES) as KokoroVoice[]).map((id) => ({ id, ...KOKORO_VOICES[id] }));
}

export function kokoroVoiceLabel(voice?: string): string {
  return KOKORO_VOICES[normalizeKokoroVoice(voice)].label;
}

export function kokoroVoiceLangCode(voice?: string): KokoroLangCode {
  return KOKORO_VOICES[normalizeKokoroVoice(voice)].langCode;
}

export function kokoroRate(rate = 1): number {
  const scale = Number.isFinite(rate) && rate > 0 ? Math.max(0.6, Math.min(1.5, rate)) : 1;
  return Number(scale.toFixed(2));
}

export function normalizeKokoroText(text: string): string {
  return String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

export function kokoroTtsCachePath(home: string, input: KokoroTtsRequest): KokoroTtsCacheEntry {
  const text = normalizeKokoroText(input.text);
  const voice = normalizeKokoroVoice(input.voice);
  const langCode = kokoroVoiceLangCode(voice);
  const rate = kokoroRate(input.rate);
  const id = createHash('sha256').update(JSON.stringify({
    engine: 'kokoro',
    langCode,
    model: KOKORO_MODEL_ID,
    rate,
    schema: KOKORO_CACHE_SCHEMA,
    text,
    voice,
  })).digest('hex');
  const dir = kokoroTtsCacheDir(home);
  return { dir, id, path: join(dir, `${id}.wav`), voice, langCode, rate };
}

export function kokoroTtsCacheDir(home: string): string {
  return join(kokoroReaderSupportDir(home), 'tts-cache', 'kokoro');
}

export function isValidKokoroCacheFile(path: string): boolean {
  let fd: number | undefined;
  try {
    const stat = statSync(path);
    if (!stat.isFile() || stat.size < KOKORO_MIN_WAV_BYTES) return false;
    const header = Buffer.allocUnsafe(12);
    fd = openSync(path, 'r');
    if (readSync(fd, header, 0, header.length, 0) !== header.length) return false;
    return header.toString('ascii', 0, 4) === 'RIFF' && header.toString('ascii', 8, 12) === 'WAVE';
  } catch {
    return false;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

export function markKokoroCacheUsed(path: string): void {
  if (!isValidKokoroCacheFile(path)) return;
  try {
    chmodSync(path, 0o600);
    const now = new Date();
    utimesSync(path, now, now);
  } catch {}
}

export function kokoroTtsCacheStats(home: string): KokoroCacheStats {
  const dir = kokoroTtsCacheDir(home);
  hardenCachePermissions(dir);
  const files = kokoroCacheFiles(dir);
  return {
    bytes: files.reduce((sum, file) => sum + file.size, 0),
    files: files.length,
    maxAgeMs: KOKORO_CACHE_MAX_AGE_MS,
    maxBytes: KOKORO_CACHE_MAX_BYTES,
  };
}

export function pruneKokoroTtsCache(
  home: string,
  options: { maxAgeMs?: number; maxBytes?: number; now?: number } = {},
): KokoroCacheClearResult {
  const dir = kokoroTtsCacheDir(home);
  const now = options.now ?? Date.now();
  const maxAgeMs = finiteNonNegative(options.maxAgeMs, KOKORO_CACHE_MAX_AGE_MS);
  const maxBytes = finiteNonNegative(options.maxBytes, KOKORO_CACHE_MAX_BYTES);
  let removedBytes = 0;
  let removedFiles = 0;
  let files = kokoroCacheFiles(dir);

  for (const file of kokoroTemporaryFiles(dir)) {
    if (isCachePathActive(file.path) || now - file.mtimeMs <= STALE_TEMP_FILE_MS) continue;
    if (removeCacheFile(file.path)) {
      removedBytes += file.size;
      removedFiles += 1;
    }
  }

  for (const file of files) {
    if (isCachePathActive(file.path)) continue;
    if (!isValidKokoroCacheFile(file.path) || now - file.mtimeMs > maxAgeMs) {
      if (removeCacheFile(file.path)) {
        removedBytes += file.size;
        removedFiles += 1;
      }
    }
  }

  files = kokoroCacheFiles(dir).sort((a, b) => a.mtimeMs - b.mtimeMs);
  let bytes = files.reduce((sum, file) => sum + file.size, 0);
  for (const file of files) {
    if (bytes <= maxBytes) break;
    if (isCachePathActive(file.path)) continue;
    if (removeCacheFile(file.path)) {
      bytes -= file.size;
      removedBytes += file.size;
      removedFiles += 1;
    }
  }

  return { ...kokoroTtsCacheStats(home), removedBytes, removedFiles };
}

export function clearKokoroTtsCache(
  home: string,
  options: { now?: number; preserveRecentMs?: number } = {},
): KokoroCacheClearResult {
  const now = options.now ?? Date.now();
  const preserveRecentMs = finiteNonNegative(options.preserveRecentMs, KOKORO_CACHE_CLEAR_GRACE_MS);
  let removedBytes = 0;
  let removedFiles = 0;
  for (const file of kokoroCacheFiles(kokoroTtsCacheDir(home))) {
    if (isCachePathActive(file.path)) continue;
    if (preserveRecentMs > 0 && now - file.mtimeMs < preserveRecentMs) continue;
    if (removeCacheFile(file.path)) {
      removedBytes += file.size;
      removedFiles += 1;
    }
  }
  for (const file of kokoroTemporaryFiles(kokoroTtsCacheDir(home))) {
    if (isCachePathActive(file.path) || now - file.mtimeMs <= STALE_TEMP_FILE_MS) continue;
    if (removeCacheFile(file.path)) {
      removedBytes += file.size;
      removedFiles += 1;
    }
  }
  return { ...kokoroTtsCacheStats(home), removedBytes, removedFiles };
}

export function kokoroTtsVenvDir(home: string): string {
  return join(kokoroReaderSupportDir(home), 'kokoro-venv');
}

export function kokoroReaderSupportDir(home: string): string {
  return join(home, 'Library', 'Application Support', 'Kokoro Reader');
}

export function legacyKokoroTtsVenvDir(home: string): string {
  return join(home, '.diffstory', 'kokoro-venv');
}

export function kokoroPythonCommand(home: string, override?: string): string {
  const forced = String(override ?? process.env.KOKORO_READER_PYTHON ?? process.env.DIFFSTORY_KOKORO_PYTHON ?? '').trim();
  if (forced) return forced;
  const managed = join(kokoroTtsVenvDir(home), 'bin', 'python');
  if (existsSync(managed)) return managed;
  const legacyManaged = join(legacyKokoroTtsVenvDir(home), 'bin', 'python');
  if (existsSync(legacyManaged)) return legacyManaged;
  return existsSync(managed) ? managed : DEFAULT_PYTHON;
}

export function kokoroTtsUrl(id: string): string {
  return `/api/tts/kokoro/${id}.wav`;
}

export function isKokoroTtsId(id: string): boolean {
  return /^[a-f0-9]{64}$/.test(id);
}

export async function synthesizeWithKokoro(
  home: string,
  input: KokoroTtsRequest,
  opts: { command?: string; signal?: AbortSignal } = {},
): Promise<KokoroTtsCacheEntry & { cached: boolean; url: string }> {
  const text = normalizeKokoroText(input.text);
  if (!text) throw new Error('No text to speak.');
  if (text.length > KOKORO_MAX_TEXT) throw new Error(`Text is too long for Kokoro speech (${KOKORO_MAX_TEXT} chars max).`);
  if (opts.signal?.aborted) throw speechCancelled();

  const entry = kokoroTtsCachePath(home, { ...input, text });
  if (useCachedEntry(entry.path)) return { ...entry, cached: true, url: kokoroTtsUrl(entry.id) };

  return shareSynthesis(ONE_SHOT_SYNTHESIS, entry.path, opts.signal, async (signal) => {
    if (useCachedEntry(entry.path)) return { ...entry, cached: true, url: kokoroTtsUrl(entry.id) };
    ensurePrivateDirectory(entry.dir);
    const helper = ensureKokoroHelper(entry.dir);
    const temporaryPath = temporaryKokoroPath(entry.path);
    return withActiveCachePaths([entry.path, temporaryPath], async () => {
      await runKokoro(
        kokoroPythonCommand(home, opts.command),
        [helper, temporaryPath, entry.voice, String(entry.rate), entry.langCode],
        text,
        temporaryPath,
        signal,
      );
      publishKokoroCacheFile(temporaryPath, entry.path);
      pruneKokoroTtsCache(home);
      return { ...entry, cached: false, url: kokoroTtsUrl(entry.id) };
    });
  });
}

export function createKokoroSynthesizerSession(
  home: string,
  opts: {
    command?: string;
    maxQueuePerWorker?: number;
    timeoutMs?: number;
    workers?: number;
  } = {},
): KokoroSynthesizerSession {
  const workerCount = kokoroWorkerCount(opts.workers);
  const dir = kokoroTtsCacheDir(home);
  const command = kokoroPythonCommand(home, opts.command);
  const helper = ensureKokoroWorkerHelper(dir);
  const maxQueuePerWorker = positiveInteger(opts.maxQueuePerWorker, KOKORO_MAX_QUEUE_PER_WORKER);
  const timeoutMs = positiveInteger(opts.timeoutMs, KOKORO_WORKER_TIMEOUT_MS);
  const workers = Array.from(
    { length: workerCount },
    () => new KokoroWorker(command, helper, { maxQueue: maxQueuePerWorker, timeoutMs }),
  );
  const inFlight = new Map<string, SharedSynthesis<KokoroTtsCacheEntry & { cached: boolean; url: string }>>();
  pruneKokoroTtsCache(home);

  return {
    async synthesize(input, requestOpts = {}) {
      const text = normalizeKokoroText(input.text);
      if (!text) throw new Error('No text to speak.');
      if (text.length > KOKORO_MAX_TEXT) throw new Error(`Text is too long for Kokoro speech (${KOKORO_MAX_TEXT} chars max).`);
      if (requestOpts.signal?.aborted) throw speechCancelled();

      const entry = kokoroTtsCachePath(home, { ...input, text });
      if (useCachedEntry(entry.path)) return { ...entry, cached: true, url: kokoroTtsUrl(entry.id) };

      return shareSynthesis(inFlight, entry.path, requestOpts.signal, async (signal) => {
        if (useCachedEntry(entry.path)) return { ...entry, cached: true, url: kokoroTtsUrl(entry.id) };
        const worker = workers.reduce((least, candidate) => candidate.load < least.load ? candidate : least);
        if (worker.load >= maxQueuePerWorker) throw new KokoroCapacityError();
        ensurePrivateDirectory(entry.dir);
        const temporaryPath = temporaryKokoroPath(entry.path);
        return withActiveCachePaths([entry.path, temporaryPath], async () => {
          await worker.run({
            langCode: entry.langCode,
            outputPath: temporaryPath,
            rate: entry.rate,
            text,
            voice: entry.voice,
          }, signal);
          publishKokoroCacheFile(temporaryPath, entry.path);
          pruneKokoroTtsCache(home);
          return { ...entry, cached: false, url: kokoroTtsUrl(entry.id) };
        });
      });
    },
    dispose() {
      for (const shared of inFlight.values()) shared.controller.abort();
      inFlight.clear();
      for (const worker of workers) worker.dispose();
    },
  };
}

export function createManagedKokoroSynthesizer(
  home: string,
  opts: {
    command?: string;
    createSession?: () => KokoroSynthesizerSession;
    idleMs?: number;
    maxQueuePerWorker?: number;
    timeoutMs?: number;
    workers?: number;
  } = {},
): ManagedKokoroSynthesizer {
  const idleMs = Number.isFinite(opts.idleMs) ? Math.max(0, Number(opts.idleMs)) : KOKORO_IDLE_UNLOAD_MS;
  let activeRequests = 0;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let session: KokoroSynthesizerSession | undefined;

  const clearIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = undefined;
  };
  const disposeSession = () => {
    clearIdleTimer();
    session?.dispose();
    session = undefined;
  };
  const scheduleIdleUnload = () => {
    clearIdleTimer();
    if (!session || activeRequests > 0) return;
    if (idleMs === 0) {
      disposeSession();
      return;
    }
    idleTimer = setTimeout(disposeSession, idleMs);
    idleTimer.unref?.();
  };
  const ensureSession = () => {
    session ??= opts.createSession?.() ?? createKokoroSynthesizerSession(home, {
      command: opts.command,
      maxQueuePerWorker: opts.maxQueuePerWorker,
      timeoutMs: opts.timeoutMs,
      workers: opts.workers ?? 1,
    });
    return session;
  };

  return {
    async synthesize(input, requestOpts = {}) {
      clearIdleTimer();
      activeRequests += 1;
      try {
        return await ensureSession().synthesize(input, requestOpts);
      } finally {
        activeRequests -= 1;
        scheduleIdleUnload();
      }
    },
    dispose() {
      disposeSession();
    },
  };
}

export function kokoroWorkerCount(value = 1): number {
  const n = Number.isFinite(value) ? Math.trunc(value) : 1;
  return Math.max(1, Math.min(4, n));
}

function ensureKokoroHelper(dir: string): string {
  ensurePrivateDirectory(dir);
  const path = join(dir, 'kokoro_synth.py');
  writeFileSync(path, KOKORO_HELPER, { encoding: 'utf8', mode: 0o600 });
  chmodSync(path, 0o600);
  return path;
}

function ensureKokoroWorkerHelper(dir: string): string {
  ensurePrivateDirectory(dir);
  const path = join(dir, 'kokoro_worker.py');
  writeFileSync(path, KOKORO_WORKER_HELPER, { encoding: 'utf8', mode: 0o600 });
  chmodSync(path, 0o600);
  return path;
}

function kokoroUnavailable(detail: string): Error {
  const suffix = detail ? ` ${detail}` : '';
  return new Error(`Kokoro is unavailable. Run: npm run setup:kokoro. It creates Kokoro Reader's local Python environment and installs espeak-ng, kokoro, and soundfile.${suffix}`);
}

function speechCancelled(): Error {
  const err = new Error('Speech generation cancelled.');
  err.name = 'AbortError';
  return err;
}

interface KokoroCacheFile {
  mtimeMs: number;
  path: string;
  size: number;
}

function kokoroCacheFiles(dir: string): KokoroCacheFile[] {
  try {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      if (!entry.isFile() || !/^[a-f0-9]{64}\.wav$/.test(entry.name)) return [];
      const path = join(dir, entry.name);
      try {
        chmodSync(path, 0o600);
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

function kokoroTemporaryFiles(dir: string): KokoroCacheFile[] {
  try {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      if (!entry.isFile() || !entry.name.endsWith('.tmp.wav')) return [];
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

function ensurePrivateDirectory(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
}

function hardenCachePermissions(dir: string): void {
  if (!existsSync(dir)) return;
  try { chmodSync(dir, 0o700); } catch {}
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      try { chmodSync(join(dir, entry.name), 0o600); } catch {}
    }
  } catch {}
}

function removeCacheFile(path: string): boolean {
  try {
    rmSync(path);
    return true;
  } catch {
    return false;
  }
}

function useCachedEntry(path: string): boolean {
  if (!existsSync(path)) return false;
  if (!isValidKokoroCacheFile(path)) {
    rmSync(path, { force: true });
    return false;
  }
  markKokoroCacheUsed(path);
  return true;
}

function temporaryKokoroPath(path: string): string {
  return `${path}.${process.pid}.${randomUUID()}.tmp.wav`;
}

function publishKokoroCacheFile(temporaryPath: string, finalPath: string): void {
  if (!isValidKokoroCacheFile(temporaryPath)) {
    rmSync(temporaryPath, { force: true });
    throw new Error('Kokoro produced an invalid audio file.');
  }
  try {
    chmodSync(temporaryPath, 0o600);
    renameSync(temporaryPath, finalPath);
    chmodSync(finalPath, 0o600);
    markKokoroCacheUsed(finalPath);
  } catch (err) {
    rmSync(temporaryPath, { force: true });
    throw err;
  }
}

async function withActiveCachePaths<T>(paths: string[], operation: () => Promise<T>): Promise<T> {
  for (const path of paths) ACTIVE_CACHE_PATHS.set(path, (ACTIVE_CACHE_PATHS.get(path) ?? 0) + 1);
  try {
    return await operation();
  } finally {
    for (const path of paths) {
      const remaining = (ACTIVE_CACHE_PATHS.get(path) ?? 1) - 1;
      if (remaining > 0) ACTIVE_CACHE_PATHS.set(path, remaining);
      else ACTIVE_CACHE_PATHS.delete(path);
    }
    for (const path of paths.slice(1)) rmSync(path, { force: true });
  }
}

function isCachePathActive(path: string): boolean {
  return (ACTIVE_CACHE_PATHS.get(path) ?? 0) > 0;
}

function shareSynthesis<T>(
  inFlight: Map<string, SharedSynthesis<T>>,
  key: string,
  signal: AbortSignal | undefined,
  create: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  if (signal?.aborted) return Promise.reject(speechCancelled());
  let shared = inFlight.get(key);
  if (shared?.controller.signal.aborted) {
    inFlight.delete(key);
    shared = undefined;
  }
  if (!shared) {
    const controller = new AbortController();
    const next: SharedSynthesis<T> = {
      consumers: 0,
      controller,
      promise: Promise.resolve(undefined as T),
      settled: false,
    };
    next.promise = Promise.resolve()
      .then(() => create(controller.signal))
      .finally(() => {
        next.settled = true;
        if (inFlight.get(key) === next) inFlight.delete(key);
      });
    inFlight.set(key, next);
    shared = next;
  }

  shared.consumers += 1;
  const current = shared;
  return new Promise<T>((resolve, reject) => {
    let finished = false;
    const finish = () => {
      if (finished) return false;
      finished = true;
      signal?.removeEventListener('abort', onAbort);
      current.consumers -= 1;
      return true;
    };
    const onAbort = () => {
      if (!finish()) return;
      reject(speechCancelled());
      if (current.consumers === 0 && !current.settled) current.controller.abort();
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    current.promise.then(
      (value) => {
        if (finish()) resolve(value);
      },
      (err: unknown) => {
        if (finish()) reject(err);
      },
    );
  });
}

function finiteNonNegative(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? Math.max(0, Number(value)) : fallback;
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.trunc(Number(value))) : fallback;
}

function appendBounded(current: string, chunk: string): string {
  const next = current + chunk;
  if (Buffer.byteLength(next) <= MAX_PROCESS_OUTPUT_BYTES) return next;
  return Buffer.from(next).subarray(-MAX_PROCESS_OUTPUT_BYTES).toString('utf8');
}

function terminateChild(child: ChildProcess, onClose?: () => void): void {
  let closed = false;
  const finish = () => {
    if (closed) return;
    closed = true;
    clearTimeout(killTimer);
    onClose?.();
  };
  const killTimer = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }, WORKER_KILL_GRACE_MS);
  killTimer.unref?.();
  child.once('close', finish);
  if (child.exitCode !== null || child.signalCode !== null) {
    queueMicrotask(finish);
    return;
  }
  child.kill('SIGTERM');
}

function runKokoro(command: string, args: string[], text: string, outputPath: string, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      rmSync(outputPath, { force: true });
      reject(speechCancelled());
      return;
    }
    const child = spawn(command, args, {
      stdio: ['pipe', 'ignore', 'pipe'],
      env: kokoroEnv(),
    });
    let stderr = '';
    let settled = false;
    let terminationReason: Error | undefined;
    const timer = setTimeout(() => {
      terminationReason = new KokoroTimeoutError();
      terminateChild(child);
    }, KOKORO_WORKER_TIMEOUT_MS);
    timer.unref?.();
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (err) {
        rmSync(outputPath, { force: true });
        reject(err);
      } else {
        resolve();
      }
    };
    const onAbort = () => {
      terminationReason = speechCancelled();
      terminateChild(child);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    child.stderr.on('data', (chunk) => {
      stderr = appendBounded(stderr, String(chunk));
    });
    child.on('error', (err) => {
      finish(kokoroUnavailable(err.message));
    });
    child.on('close', (code) => {
      if (terminationReason) finish(terminationReason);
      else if (code === 0) finish();
      else finish(kokoroUnavailable(stderr.trim() || `python exited with status ${code}`));
    });
    child.stdin.end(text);
  });
}

interface KokoroWorkerRequest {
  langCode: KokoroLangCode;
  outputPath: string;
  rate: number;
  text: string;
  voice: KokoroVoice;
}

interface KokoroWorkerTask {
  id: number;
  onAbort?: () => void;
  reject: (err: Error) => void;
  request: KokoroWorkerRequest;
  resolve: () => void;
  signal?: AbortSignal;
  timer?: ReturnType<typeof setTimeout>;
}

class KokoroWorker {
  private active?: KokoroWorkerTask;
  private child?: ChildProcessWithoutNullStreams;
  private disposed = false;
  private nextId = 1;
  private readonly queue: KokoroWorkerTask[] = [];
  private restarting = false;
  private stderr = '';
  private stdoutBuffer = '';

  constructor(
    private readonly command: string,
    private readonly helper: string,
    private readonly options: { maxQueue: number; timeoutMs: number },
  ) {}

  get load(): number {
    return this.queue.length + (this.active ? 1 : 0);
  }

  run(request: KokoroWorkerRequest, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        rmSync(request.outputPath, { force: true });
        reject(speechCancelled());
        return;
      }
      if (this.disposed) {
        reject(speechCancelled());
        return;
      }
      if (this.load >= this.options.maxQueue) {
        reject(new KokoroCapacityError());
        return;
      }
      const task: KokoroWorkerTask = {
        id: this.nextId++,
        reject,
        request,
        resolve,
        signal,
      };
      task.onAbort = () => this.cancel(task);
      signal?.addEventListener('abort', task.onAbort, { once: true });
      this.queue.push(task);
      this.pump();
    });
  }

  dispose(): void {
    this.disposed = true;
    const child = this.child;
    this.child = undefined;
    if (child) terminateChild(child);
    this.failAll(speechCancelled());
  }

  private ensureChild(): ChildProcessWithoutNullStreams {
    if (this.child && !this.child.killed) return this.child;
    const child = spawn(this.command, [this.helper], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: kokoroEnv(),
    });
    this.child = child;
    this.stderr = '';
    this.stdoutBuffer = '';
    child.stdout.on('data', (chunk) => {
      if (this.child === child) this.readStdout(String(chunk));
    });
    child.stderr.on('data', (chunk) => {
      if (this.child === child) this.stderr = appendBounded(this.stderr, String(chunk));
    });
    child.on('error', (err) => {
      if (this.child !== child) return;
      this.child = undefined;
      this.failAll(kokoroUnavailable(err.message));
    });
    child.on('close', (code) => {
      if (this.child !== child) return;
      this.child = undefined;
      const detail = this.stderr.trim() || `python worker exited with status ${code}`;
      this.failAll(kokoroUnavailable(detail));
    });
    return child;
  }

  private restartActive(reason: Error): void {
    const task = this.active;
    this.active = undefined;
    const child = this.child;
    this.child = undefined;
    this.restarting = Boolean(child);
    if (child) terminateChild(child, () => {
      this.restarting = false;
      this.pump();
    });
    if (task) this.settle(task, reason);
    if (!child) queueMicrotask(() => this.pump());
  }

  private pump(): void {
    if (this.disposed || this.restarting || this.active || this.queue.length === 0) return;
    const task = this.queue.shift();
    if (!task) return;
    if (task.signal?.aborted) {
      this.settle(task, speechCancelled());
      queueMicrotask(() => this.pump());
      return;
    }
    this.active = task;
    task.timer = setTimeout(() => {
      if (this.active === task) this.restartActive(new KokoroTimeoutError());
    }, this.options.timeoutMs);
    task.timer.unref?.();

    const child = this.ensureChild();
    const payload = {
      id: task.id,
      lang_code: task.request.langCode,
      out_path: task.request.outputPath,
      speed: task.request.rate,
      text: task.request.text,
      voice: task.request.voice,
    };
    child.stdin.write(`${JSON.stringify(payload)}\n`, (err) => {
      if (err && this.active === task) this.restartActive(kokoroUnavailable(err.message));
    });
  }

  private cancel(task: KokoroWorkerTask): void {
    rmSync(task.request.outputPath, { force: true });
    if (this.active === task) {
      this.restartActive(speechCancelled());
      return;
    }
    const index = this.queue.indexOf(task);
    if (index >= 0) this.queue.splice(index, 1);
    this.settle(task, speechCancelled());
  }

  private readStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    if (Buffer.byteLength(this.stdoutBuffer) > MAX_WORKER_LINE_BYTES) {
      this.restartActive(kokoroUnavailable('python worker returned an oversized response'));
      return;
    }
    for (;;) {
      const newline = this.stdoutBuffer.indexOf('\n');
      if (newline === -1) return;
      const line = this.stdoutBuffer.slice(0, newline).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      if (line) this.handleLine(line);
    }
  }

  private handleLine(line: string): void {
    let message: { id?: number; ok?: boolean; error?: string };
    try {
      message = JSON.parse(line) as { id?: number; ok?: boolean; error?: string };
    } catch {
      return;
    }
    if (typeof message.id !== 'number') {
      if (message.ok === false) {
        const child = this.child;
        this.child = undefined;
        this.restarting = Boolean(child);
        if (child) terminateChild(child, () => {
          this.restarting = false;
          this.pump();
        });
        this.failAll(kokoroUnavailable(message.error ?? 'python worker failed'));
      }
      return;
    }
    const task = this.active;
    if (!task || task.id !== message.id) return;
    this.active = undefined;
    if (message.ok) {
      this.settle(task);
    } else {
      rmSync(task.request.outputPath, { force: true });
      this.settle(task, kokoroUnavailable(message.error ?? 'python worker failed'));
    }
    queueMicrotask(() => this.pump());
  }

  private settle(task: KokoroWorkerTask, err?: Error): void {
    if (task.timer) clearTimeout(task.timer);
    task.signal?.removeEventListener('abort', task.onAbort!);
    if (err) task.reject(err);
    else task.resolve();
  }

  private failAll(err: Error): void {
    const tasks = [this.active, ...this.queue].filter((task): task is KokoroWorkerTask => Boolean(task));
    this.active = undefined;
    this.queue.length = 0;
    for (const task of tasks) {
      rmSync(task.request.outputPath, { force: true });
      this.settle(task, err);
    }
  }
}

function kokoroEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    KOKORO_READER_DEVICE: process.env.KOKORO_READER_DEVICE ?? process.env.DIFFSTORY_KOKORO_DEVICE ?? 'cpu',
    DIFFSTORY_KOKORO_DEVICE: process.env.DIFFSTORY_KOKORO_DEVICE ?? 'cpu',
    PYTORCH_ENABLE_MPS_FALLBACK: process.env.PYTORCH_ENABLE_MPS_FALLBACK ?? '1',
  };
}
