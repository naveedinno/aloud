import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import {
  kokoroRate,
  kokoroWorkerCount,
} from './kokoro-tts.js';
import {
  createManagedSpeechSynthesizer,
  type SpeechEngine,
  type SpeechSynthesisResult,
  type SpeechSynthesizer,
} from './speech-engine.js';

export interface SpeakArgs {
  batch: boolean;
  controller: boolean;
  daemon: boolean;
  engine: SpeechEngine;
  engineExplicit: boolean;
  help: boolean;
  mode: SpeechMode;
  modeExplicit: boolean;
  noOpen: boolean;
  prefetch: number;
  rate: number;
  rateExplicit: boolean;
  stdin: boolean;
  text: string;
  voice: string;
  voiceExplicit: boolean;
  workers: number;
}

export type SpeechResult = SpeechSynthesisResult;
export interface SpeechPlaybackHandle {
  readonly paused: boolean;
  pause: () => void;
  resume: () => void;
  stop: () => void;
}
export type SpeechPlayer = (path: string, opts?: {
  onPlaybackHandle?: (handle: SpeechPlaybackHandle | undefined) => void;
  rate?: number;
  signal?: AbortSignal;
}) => Promise<void>;
export type SpeechMode = 'auto' | 'fast-start' | 'smooth';
export type SpeechProgressStatus = 'generating' | 'reading';
export const DEFAULT_SPEECH_BATCH_CHARS = 650;
export const FIRST_SPEECH_BATCH_CHARS = 260;
export const SMOOTH_SPEECH_BATCH_CHARS = 900;

export interface SpeechProgress {
  chunkText: string;
  current: number;
  index: number;
  message: string;
  status: SpeechProgressStatus;
  total: number;
}

export interface SpeechChunkRange {
  end: number;
  start: number;
}

export interface SpeakTextOptions {
  batch?: boolean;
  batches?: string[];
  engine?: SpeechEngine;
  home?: string;
  mode?: SpeechMode;
  prefetch?: number;
  playbackRate?: number | (() => number);
  text: string;
  voice?: string;
  rate?: number | (() => number);
  synthesize?: SpeechSynthesizer;
  player?: SpeechPlayer;
  onProgress?: (progress: SpeechProgress) => void;
  onPlaybackHandle?: (handle: SpeechPlaybackHandle | undefined) => void;
  signal?: AbortSignal;
  startAt?: number;
  workers?: number;
}

export function parseSpeakArgs(argv: string[]): SpeakArgs {
  const args = argv[0] === 'speak' ? argv.slice(1) : argv;
  const parsed: SpeakArgs = {
    batch: true,
    controller: false,
    daemon: false,
    engine: 'kokoro',
    engineExplicit: false,
    help: false,
    mode: 'fast-start',
    modeExplicit: false,
    noOpen: true,
    prefetch: 3,
    rate: 1,
    rateExplicit: false,
    stdin: false,
    text: '',
    voice: 'af_heart',
    voiceExplicit: false,
    workers: 1,
  };
  const text: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const token = args[i];
    if (token === '--stdin') parsed.stdin = true;
    else if (token === '--batch') parsed.batch = true;
    else if (token === '--no-batch') parsed.batch = false;
    else if (token === '--mode') {
      parsed.mode = speechMode(args[++i]);
      parsed.modeExplicit = true;
    } else if (token === '--auto') {
      parsed.mode = 'auto';
      parsed.modeExplicit = true;
    } else if (token === '--fast-start') {
      parsed.mode = 'fast-start';
      parsed.modeExplicit = true;
    } else if (token === '--smooth' || token === '--whole-text') {
      parsed.mode = 'smooth';
      parsed.modeExplicit = true;
    }
    else if (token === '--no-open') parsed.noOpen = true;
    else if (token === '--open') parsed.noOpen = false;
    else if (token === '--controller' || token === '--popup') parsed.controller = true;
    else if (token === '--daemon') parsed.daemon = true;
    else if (token === '--engine') {
      parsed.engine = String(args[++i] ?? '').toLowerCase() === 'pocket' ? 'pocket' : 'kokoro';
      parsed.engineExplicit = true;
    }
    else if (token === '--pocket') { parsed.engine = 'pocket'; parsed.engineExplicit = true; }
    else if (token === '--kokoro') { parsed.engine = 'kokoro'; parsed.engineExplicit = true; }
    else if (token === '--prefetch') parsed.prefetch = prefetchWindow(Number(args[++i]));
    else if (token === '--workers') parsed.workers = kokoroWorkerCount(Number(args[++i]));
    else if (token === '--voice') {
      parsed.voice = args[++i] ?? parsed.voice;
      parsed.voiceExplicit = true;
    } else if (token === '--rate') {
      parsed.rate = Number(args[++i]) || parsed.rate;
      parsed.rateExplicit = true;
    }
    else if (token === '--help' || token === '-h') parsed.help = true;
    else text.push(token);
  }
  parsed.text = text.join(' ').trim();
  if (!parsed.text) parsed.stdin = true;
  return parsed;
}

export async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function speakText(options: SpeakTextOptions): Promise<SpeechResult> {
  const text = String(options.text ?? '').trim();
  if (!text) throw new Error('No text to speak.');

  const home = options.home ?? homedir();
  const session = options.synthesize ? undefined : createManagedSpeechSynthesizer(home);
  const synthesize = options.synthesize ?? session!.synthesize;
  const player = options.player ?? playAudio;
  try {
    if (options.batch === false) {
      return await speakFullText({ ...options, home, text, synthesize, player });
    }
    return await speakTextInBatches({ ...options, home, text, synthesize, player });
  } finally {
    session?.dispose();
  }
}

export function splitTextIntoSpeechBatches(
  text: string,
  maxChars = DEFAULT_SPEECH_BATCH_CHARS,
  firstMaxChars = Math.min(FIRST_SPEECH_BATCH_CHARS, maxChars),
): string[] {
  const clean = String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
  if (!clean) return [];

  const sentences = splitSentences(clean);
  const units = sentences.flatMap((sentence) => sentence.length <= maxChars
    ? [sentence]
    : splitLongSentence(sentence, maxChars));
  const batches: string[] = [];
  let current = '';
  for (const unit of units) {
    const limit = batches.length === 0 ? firstMaxChars : maxChars;
    const combined = current ? `${current} ${unit}` : unit;
    if (current && combined.length > limit) {
      batches.push(current);
      current = unit;
    } else {
      current = combined;
    }
  }
  if (current) batches.push(current);
  return batches;
}

export function speechBatchesForMode(text: string, mode?: SpeechMode): string[] {
  const selected = speechMode(mode);
  if (selected === 'smooth') {
    // Smooth playback still has to respect Kokoro's per-request limit. It uses
    // longer batches and a larger prefetch queue, not one unbounded request.
    return splitTextIntoSpeechBatches(text, SMOOTH_SPEECH_BATCH_CHARS, SMOOTH_SPEECH_BATCH_CHARS);
  }
  return selected === 'fast-start'
    ? splitTextIntoSpeechBatches(text, 520, 170)
    : splitTextIntoSpeechBatches(text);
}

export function speechPrefetchForMode(mode?: SpeechMode): number {
  return speechMode(mode) === 'smooth' ? 6 : 3;
}

export function speechChunkRanges(text: string, chunks: string[]): Array<SpeechChunkRange | undefined> {
  const source = mappedSpeechText(text);
  let cursor = 0;
  return chunks.map((chunk) => {
    const needle = mappedSpeechText(chunk).text;
    if (!needle) return undefined;
    const offset = source.text.indexOf(needle, cursor);
    if (offset < 0) return undefined;
    cursor = offset + needle.length;
    return {
      start: source.map[offset],
      end: source.map[offset + needle.length - 1] + 1,
    };
  });
}

function mappedSpeechText(value: string): { map: number[]; text: string } {
  const chars: string[] = [];
  const map: number[] = [];
  let pendingWhitespace = -1;
  for (let index = 0; index < value.length; index++) {
    const char = value[index];
    if (/\s/.test(char)) {
      if (chars.length > 0 && pendingWhitespace < 0) pendingWhitespace = index;
      continue;
    }
    if (pendingWhitespace >= 0) {
      chars.push(' ');
      map.push(pendingWhitespace);
      pendingWhitespace = -1;
    }
    chars.push(char);
    map.push(index);
  }
  return { map, text: chars.join('') };
}

async function speakTextInBatches(options: Required<Pick<SpeakTextOptions, 'text' | 'synthesize' | 'player'>> & SpeakTextOptions): Promise<SpeechResult> {
  const home = options.home ?? homedir();
  const batches = options.batches?.map((batch) => String(batch).trim()).filter(Boolean)
    ?? speechBatchesForMode(options.text, options.mode);
  if (batches.length === 0) throw new Error('No text to speak.');
  const startAt = Math.max(0, Math.min(batches.length - 1, Math.trunc(options.startAt ?? 0)));
  const prefetch = prefetchWindow(options.prefetch);
  options.onProgress?.({
    chunkText: batches[startAt],
    current: startAt,
    index: startAt,
    message: batches.length === 1 ? 'Generating selected text' : `Generating chunk ${startAt + 1} of ${batches.length}`,
    status: 'generating',
    total: batches.length,
  });

  const synthesizeBatch = (text: string) => options.synthesize(home, {
    ...(options.engine ? { engine: options.engine } : {}),
    text,
    voice: options.voice,
    rate: speechRate(options.rate),
  }, { signal: options.signal }).then(
    (result) => ({ result }),
    (error: unknown) => ({ error }),
  );

  const tasks = new Map<number, ReturnType<typeof synthesizeBatch>>();
  let nextToSchedule = startAt;
  const schedule = (index: number) => {
    if (!tasks.has(index)) tasks.set(index, synthesizeBatch(batches[index]));
  };
  const scheduleThrough = (lastIndex: number) => {
    while (nextToSchedule < batches.length && nextToSchedule <= lastIndex) {
      schedule(nextToSchedule);
      nextToSchedule += 1;
    }
  };

  scheduleThrough(startAt);
  let first: SpeechResult | undefined;
  for (let i = startAt; i < batches.length; i++) {
    const currentTask = tasks.get(i);
    if (!currentTask) throw new Error(`Speech batch ${i + 1} was not scheduled.`);
    const current = await currentTask;
    if ('error' in current) throw current.error;
    first ??= current.result;
    scheduleThrough(i + prefetch);
    options.onProgress?.({
      chunkText: batches[i],
      current: i + 1,
      index: i,
      message: batches.length === 1 ? 'Reading selected text' : `Reading chunk ${i + 1} of ${batches.length}`,
      status: 'reading',
      total: batches.length,
    });
    await options.player(current.result.path, {
      onPlaybackHandle: options.onPlaybackHandle,
      rate: speechRate(options.playbackRate),
      signal: options.signal,
    });
    tasks.delete(i);
    if (i + 1 < batches.length) {
      options.onProgress?.({
        chunkText: batches[i + 1],
        current: i + 1,
        index: i + 1,
        message: `Preparing chunk ${i + 2} of ${batches.length}`,
        status: 'generating',
        total: batches.length,
      });
    }
  }
  if (!first) throw new Error('No text to speak.');
  return first;
}

async function speakFullText(options: Required<Pick<SpeakTextOptions, 'text' | 'synthesize' | 'player' | 'home'>> & SpeakTextOptions): Promise<SpeechResult> {
  options.onProgress?.({
    chunkText: options.text,
    current: 0,
    index: 0,
    message: 'Generating full text',
    status: 'generating',
    total: 1,
  });

  const result = await options.synthesize(options.home, {
    ...(options.engine ? { engine: options.engine } : {}),
    text: options.text,
    voice: options.voice,
    rate: speechRate(options.rate),
  }, { signal: options.signal });
  options.onProgress?.({
    chunkText: options.text,
    current: 1,
    index: 0,
    message: 'Reading full text',
    status: 'reading',
    total: 1,
  });
  await options.player(result.path, {
    onPlaybackHandle: options.onPlaybackHandle,
    rate: speechRate(options.playbackRate),
    signal: options.signal,
  });
  return result;
}

function prefetchWindow(value = 3): number {
  const n = Number.isFinite(value) ? Math.trunc(value) : 3;
  return Math.max(1, Math.min(6, n));
}

export function speechMode(mode?: string): SpeechMode {
  const value = String(mode ?? '').toLowerCase().trim().replace(/[\s_]+/g, '-');
  if (value === 'auto' || value === 'smart') return 'auto';
  return value === 'smooth' || value === 'whole' || value === 'whole-text' || value === 'full' ? 'smooth' : 'fast-start';
}

function speechRate(rate: SpeakTextOptions['rate']): number | undefined {
  return typeof rate === 'function' ? rate() : rate;
}

function splitSentences(text: string): string[] {
  const segments: string[] = [];
  let start = 0;
  const boundary = /[.!?]+(?:["')\]]+)?(?=\s+|$)/g;
  for (const match of text.matchAll(boundary)) {
    const end = (match.index ?? 0) + match[0].length;
    const segment = text.slice(start, end).trim();
    if (segment) segments.push(segment);
    start = end;
  }
  const tail = text.slice(start).trim();
  if (tail) segments.push(tail);
  return segments.length ? segments : [text.trim()];
}

function splitLongSentence(sentence: string, maxChars: number): string[] {
  const clauses = sentence.match(/[^,;:]+[,;:]?|[^,;:]+$/g)?.map((part) => part.trim()).filter(Boolean) ?? [];
  if (clauses.length > 1) {
    const batches: string[] = [];
    let current = '';
    for (const clause of clauses) {
      if (!current) {
        current = clause;
      } else if (`${current} ${clause}`.length <= maxChars) {
        current = `${current} ${clause}`;
      } else {
        batches.push(current);
        current = clause;
      }
    }
    if (current) batches.push(current);
    if (batches.every((batch) => batch.length <= maxChars)) return batches;
  }

  const batches: string[] = [];
  let current = '';
  for (const word of sentence.split(/\s+/)) {
    if (!current) {
      current = word;
    } else if (`${current} ${word}`.length <= maxChars) {
      current = `${current} ${word}`;
    } else {
      batches.push(current);
      current = word;
    }
  }
  if (current) batches.push(current);
  return batches;
}

export function playAudio(path: string, opts: {
  onPlaybackHandle?: (handle: SpeechPlaybackHandle | undefined) => void;
  rate?: number;
  signal?: AbortSignal;
} = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    if (opts.signal?.aborted) {
      reject(speechCancelled());
      return;
    }
    const { args, command } = audioPlayerCommand(path, opts);
    const child = spawn(command, args, { stdio: 'ignore' });
    let aborted = false;
    let paused = false;
    const handle: SpeechPlaybackHandle = {
      get paused() {
        return paused;
      },
      pause: () => {
        if (paused) return;
        paused = true;
        child.kill('SIGSTOP');
      },
      resume: () => {
        if (!paused) return;
        paused = false;
        child.kill('SIGCONT');
      },
      stop: () => {
        child.kill('SIGTERM');
      },
    };
    opts.onPlaybackHandle?.(handle);
    const cleanup = () => {
      opts.signal?.removeEventListener('abort', onAbort);
      opts.onPlaybackHandle?.(undefined);
    };
    const onAbort = () => {
      aborted = true;
      handle.stop();
      reject(speechCancelled());
    };
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    child.on('error', (err) => {
      cleanup();
      if (!aborted) reject(err);
    });
    child.on('close', (code) => {
      cleanup();
      if (aborted) return;
      if (code === 0) resolve();
      else reject(new Error(`Audio playback failed with status ${code}.`));
    });
  });
}

export function audioPlayerCommand(path: string, opts: { platform?: NodeJS.Platform; rate?: number } = {}): { args: string[]; command: string } {
  const platform = opts.platform ?? process.platform;
  const command = platform === 'darwin' ? '/usr/bin/afplay' : 'afplay';
  const rate = kokoroRate(opts.rate);
  if (platform === 'darwin' && Math.abs(rate - 1) > 0.001) {
    return { command, args: ['--rate', String(rate), '--rQuality', '1', path] };
  }
  return { command, args: [path] };
}

function speechCancelled(): Error {
  const err = new Error('Speech playback cancelled.');
  err.name = 'AbortError';
  return err;
}
