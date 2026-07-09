import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const KOKORO_MAX_TEXT = 5000;
const DEFAULT_PYTHON = 'python3';
const KOKORO_HELPER = String.raw`import os
import sys

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
except Exception as exc:
    raise RuntimeError(
        'Kokoro is not installed. Run: brew install espeak-ng && python3 -m pip install "kokoro>=0.9.4" soundfile'
    ) from exc

pipeline = KPipeline(lang_code=lang_code, repo_id="hexgrad/Kokoro-82M", device=device)
chunks = []
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

try:
    from kokoro import KPipeline
    import numpy as np
    import soundfile as sf
except Exception as exc:
    print(json.dumps({
        "id": None,
        "ok": False,
        "error": 'Kokoro is not installed. Run: brew install espeak-ng && python3 -m pip install "kokoro>=0.9.4" soundfile'
    }), flush=True)
    raise

pipelines = {}
device = os.environ.get("KOKORO_READER_DEVICE", os.environ.get("DIFFSTORY_KOKORO_DEVICE", "cpu")) or None

def pipeline_for(lang_code):
    if lang_code not in pipelines:
        pipelines[lang_code] = KPipeline(lang_code=lang_code, repo_id="hexgrad/Kokoro-82M", device=device)
    return pipelines[lang_code]

def synthesize(request):
    pipeline = pipeline_for(request["lang_code"])
    chunks = []
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
  const id = createHash('sha256').update(JSON.stringify({ engine: 'kokoro', text, voice, langCode, rate })).digest('hex');
  const dir = kokoroTtsCacheDir(home);
  return { dir, id, path: join(dir, `${id}.wav`), voice, langCode, rate };
}

export function kokoroTtsCacheDir(home: string): string {
  return join(kokoroReaderSupportDir(home), 'tts-cache', 'kokoro');
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
  if (existsSync(entry.path)) return { ...entry, cached: true, url: kokoroTtsUrl(entry.id) };

  mkdirSync(entry.dir, { recursive: true });
  const helper = ensureKokoroHelper(entry.dir);
  await runKokoro(kokoroPythonCommand(home, opts.command), [helper, entry.path, entry.voice, String(entry.rate), entry.langCode], text, entry.path, opts.signal);
  return { ...entry, cached: false, url: kokoroTtsUrl(entry.id) };
}

export function createKokoroSynthesizerSession(
  home: string,
  opts: { command?: string; workers?: number } = {},
): KokoroSynthesizerSession {
  const workerCount = kokoroWorkerCount(opts.workers);
  const dir = kokoroTtsCacheDir(home);
  const command = kokoroPythonCommand(home, opts.command);
  const helper = ensureKokoroWorkerHelper(dir);
  const workers = Array.from({ length: workerCount }, () => new KokoroWorker(command, helper));
  let nextWorker = 0;

  return {
    async synthesize(input, requestOpts = {}) {
      const text = normalizeKokoroText(input.text);
      if (!text) throw new Error('No text to speak.');
      if (text.length > KOKORO_MAX_TEXT) throw new Error(`Text is too long for Kokoro speech (${KOKORO_MAX_TEXT} chars max).`);
      if (requestOpts.signal?.aborted) throw speechCancelled();

      const entry = kokoroTtsCachePath(home, { ...input, text });
      if (existsSync(entry.path)) return { ...entry, cached: true, url: kokoroTtsUrl(entry.id) };

      mkdirSync(entry.dir, { recursive: true });
      const worker = workers[nextWorker];
      nextWorker = (nextWorker + 1) % workers.length;
      await worker.run({
        id: entry.id,
        langCode: entry.langCode,
        outputPath: entry.path,
        rate: entry.rate,
        text,
        voice: entry.voice,
      }, requestOpts.signal);
      return { ...entry, cached: false, url: kokoroTtsUrl(entry.id) };
    },
    dispose() {
      for (const worker of workers) worker.dispose();
    },
  };
}

export function kokoroWorkerCount(value = 3): number {
  const n = Number.isFinite(value) ? Math.trunc(value) : 3;
  return Math.max(1, Math.min(4, n));
}

function ensureKokoroHelper(dir: string): string {
  const path = join(dir, 'kokoro_synth.py');
  writeFileSync(path, KOKORO_HELPER, 'utf8');
  return path;
}

function ensureKokoroWorkerHelper(dir: string): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'kokoro_worker.py');
  writeFileSync(path, KOKORO_WORKER_HELPER, 'utf8');
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
    let aborted = false;
    let stderr = '';
    const cleanupAbort = () => signal?.removeEventListener('abort', onAbort);
    const onAbort = () => {
      aborted = true;
      rmSync(outputPath, { force: true });
      child.kill('SIGTERM');
      reject(speechCancelled());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', (err) => {
      cleanupAbort();
      if (aborted) return;
      rmSync(outputPath, { force: true });
      reject(kokoroUnavailable(err.message));
    });
    child.on('close', (code) => {
      cleanupAbort();
      if (aborted) return;
      if (code === 0) return resolve();
      rmSync(outputPath, { force: true });
      reject(kokoroUnavailable(stderr.trim() || `python exited with status ${code}`));
    });
    child.stdin.end(text);
  });
}

interface KokoroWorkerRequest {
  id: string;
  langCode: KokoroLangCode;
  outputPath: string;
  rate: number;
  text: string;
  voice: KokoroVoice;
}

class KokoroWorker {
  private child?: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private stderr = '';
  private pending = new Map<number, { outputPath: string; reject: (err: Error) => void; resolve: () => void }>();
  private stdoutBuffer = '';

  constructor(private readonly command: string, private readonly helper: string) {}

  run(request: KokoroWorkerRequest, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        rmSync(request.outputPath, { force: true });
        reject(speechCancelled());
        return;
      }
      const child = this.ensureChild();
      const id = this.nextId++;
      const cleanupAbort = () => signal?.removeEventListener('abort', onAbort);
      const onAbort = () => {
        cleanupAbort();
        this.pending.delete(id);
        rmSync(request.outputPath, { force: true });
        this.restart();
        reject(speechCancelled());
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.pending.set(id, {
        outputPath: request.outputPath,
        reject: (err) => {
          cleanupAbort();
          reject(err);
        },
        resolve: () => {
          cleanupAbort();
          resolve();
        },
      });
      const payload = {
        id,
        lang_code: request.langCode,
        out_path: request.outputPath,
        speed: request.rate,
        text: request.text,
        voice: request.voice,
      };
      child.stdin.write(`${JSON.stringify(payload)}\n`);
    });
  }

  dispose(): void {
    const child = this.child;
    this.child = undefined;
    if (child && !child.killed) child.kill('SIGTERM');
    this.rejectAll(speechCancelled());
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
    child.stdout.on('data', (chunk) => this.readStdout(String(chunk)));
    child.stderr.on('data', (chunk) => {
      this.stderr += String(chunk);
    });
    child.on('error', (err) => this.rejectAll(kokoroUnavailable(err.message)));
    child.on('close', (code) => {
      if (this.child === child) this.child = undefined;
      const detail = this.stderr.trim() || `python worker exited with status ${code}`;
      this.rejectAll(kokoroUnavailable(detail));
    });
    return child;
  }

  private restart(): void {
    const child = this.child;
    this.child = undefined;
    if (child && !child.killed) child.kill('SIGTERM');
  }

  private readStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
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
      if (message.ok === false) this.rejectAll(kokoroUnavailable(message.error ?? 'python worker failed'));
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    if (message.ok) {
      pending.resolve();
    } else {
      rmSync(pending.outputPath, { force: true });
      pending.reject(kokoroUnavailable(message.error ?? 'python worker failed'));
    }
  }

  private rejectAll(err: Error): void {
    const pending = Array.from(this.pending.values());
    this.pending.clear();
    for (const item of pending) {
      rmSync(item.outputPath, { force: true });
      item.reject(err);
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
