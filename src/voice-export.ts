import { randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeSync,
} from 'node:fs';
import { join } from 'node:path';
import {
  kokoroRate,
  aloudSupportDir,
} from './kokoro-tts.js';
import {
  engineVoiceOptions,
  normalizeEngineVoice,
  normalizeSpeechEngine,
  type SpeechEngine,
  type SpeechSynthesisRequest,
  type SpeechSynthesisResult,
} from './speech-engine.js';
import { splitTextIntoSpeechBatches } from './speak.js';

const EXPORT_CHUNK_CHARACTERS = 3500;
const EXPORT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_RIFF_DATA_BYTES = 0xffff_ffff - 36;
const RANDOM_VOICE = 'random';

export type VoiceExportState = 'queued' | 'generating' | 'ready' | 'error' | 'cancelled';

export interface VoiceExportInput {
  engine?: SpeechEngine;
  filename?: string;
  rate?: number;
  text: string;
  voice?: string;
}

export interface VoiceExportStatus {
  bytes?: number;
  current: number;
  downloadUrl?: string;
  durationSeconds?: number;
  engine: SpeechEngine;
  error?: string;
  filename: string;
  id: string;
  message: string;
  progress: number;
  rate: number;
  state: VoiceExportState;
  total: number;
  voice: string;
}

export interface VoiceExportFile {
  filename: string;
  path: string;
}

export interface VoiceExportBackend {
  cancel(id: string): VoiceExportStatus | undefined;
  dispose(): void;
  file(id: string): VoiceExportFile | undefined;
  get(id: string): VoiceExportStatus | undefined;
  start(input: VoiceExportInput): VoiceExportStatus;
}

export type VoiceExportSynthesizer = (
  home: string,
  input: SpeechSynthesisRequest,
  options?: { signal?: AbortSignal },
) => Promise<SpeechSynthesisResult>;

interface VoiceExportJob {
  abort: AbortController;
  path: string;
  status: VoiceExportStatus;
}

interface WavPart {
  byteRate: number;
  data: Buffer;
  fmt: Buffer;
}

export function createVoiceExportManager(
  home: string,
  synthesize: VoiceExportSynthesizer,
): VoiceExportBackend {
  const dir = join(aloudSupportDir(home), 'exports');
  const jobs = new Map<string, VoiceExportJob>();
  let activeJob: VoiceExportJob | undefined;
  let disposed = false;
  prepareExportDirectory(dir);

  const publicStatus = (job: VoiceExportJob): VoiceExportStatus => ({ ...job.status });

  return {
    start(input) {
      if (disposed) throw new Error('Voice export is unavailable.');
      if (activeJob && ['queued', 'generating'].includes(activeJob.status.state)) {
        throw new VoiceExportBusyError();
      }
      const text = String(input.text ?? '');
      if (!text.trim()) throw new Error('No text to export.');
      const chunks = splitTextIntoSpeechBatches(
        text,
        EXPORT_CHUNK_CHARACTERS,
        EXPORT_CHUNK_CHARACTERS,
      );
      if (!chunks.length) throw new Error('No text to export.');

      const id = randomUUID();
      const engine = normalizeSpeechEngine(input.engine);
      const filename = exportFilename(input.filename);
      const voice = selectedExportVoice(engine, input.voice);
      // Pocket emits a native-rate WAV. Live playback speed is applied later by
      // afplay, but an exported file has no player in which to apply that rate.
      const rate = engine === 'pocket' ? 1 : kokoroRate(input.rate);
      const job: VoiceExportJob = {
        abort: new AbortController(),
        path: join(dir, `${id}.wav`),
        status: {
          current: 0,
          engine,
          filename,
          id,
          message: `Waiting to generate ${chunks.length} audio ${chunks.length === 1 ? 'part' : 'parts'}…`,
          progress: 0,
          rate,
          state: 'queued',
          total: chunks.length,
          voice,
        },
      };
      jobs.set(id, job);
      activeJob = job;
      void runVoiceExport(job, chunks, home, synthesize).finally(() => {
        if (activeJob === job) activeJob = undefined;
      });
      return publicStatus(job);
    },
    get(id) {
      const job = jobs.get(id);
      return job ? publicStatus(job) : undefined;
    },
    cancel(id) {
      const job = jobs.get(id);
      if (!job) return undefined;
      if (job.status.state === 'queued' || job.status.state === 'generating') {
        job.abort.abort();
        job.status = {
          ...job.status,
          message: 'Voice file export cancelled.',
          state: 'cancelled',
        };
      }
      return publicStatus(job);
    },
    file(id) {
      const job = jobs.get(id);
      if (!job || job.status.state !== 'ready' || !existsSync(job.path)) return undefined;
      return { filename: job.status.filename, path: job.path };
    },
    dispose() {
      disposed = true;
      for (const job of jobs.values()) {
        if (job.status.state === 'queued' || job.status.state === 'generating') job.abort.abort();
      }
    },
  };
}

export class VoiceExportBusyError extends Error {
  readonly statusCode = 409;

  constructor() {
    super('A voice file is already being generated. Wait for it to finish or cancel it first.');
    this.name = 'VoiceExportBusyError';
  }
}

async function runVoiceExport(
  job: VoiceExportJob,
  chunks: string[],
  home: string,
  synthesize: VoiceExportSynthesizer,
): Promise<void> {
  let fd: number | undefined;
  let fmt: Buffer | undefined;
  let byteRate = 0;
  let dataBytes = 0;
  try {
    assertNotCancelled(job.abort.signal);
    job.status = {
      ...job.status,
      message: `Generating part 1 of ${chunks.length}…`,
      state: 'generating',
    };
    for (let index = 0; index < chunks.length; index += 1) {
      assertNotCancelled(job.abort.signal);
      job.status = {
        ...job.status,
        message: `Generating part ${index + 1} of ${chunks.length}…`,
      };
      const audio = await synthesize(home, {
        engine: job.status.engine,
        rate: job.status.rate,
        text: chunks[index]!,
        voice: job.status.voice,
      }, { signal: job.abort.signal });
      assertNotCancelled(job.abort.signal);
      const part = readWavPart(audio.path);
      if (!fmt) {
        fmt = part.fmt;
        byteRate = part.byteRate;
        fd = openSync(job.path, 'wx', 0o600);
        writeSync(fd, wavHeader(fmt, 0));
      } else if (!part.fmt.equals(fmt)) {
        throw new Error('The selected voice model produced audio parts with incompatible WAV formats.');
      }
      if (dataBytes + part.data.length > MAX_RIFF_DATA_BYTES) {
        throw new Error('The generated voice file is too large for WAV format. Export less text at once.');
      }
      writeSync(fd!, part.data);
      dataBytes += part.data.length;
      job.status = {
        ...job.status,
        current: index + 1,
        message: index + 1 === chunks.length
          ? 'Finalizing voice file…'
          : `Generated part ${index + 1} of ${chunks.length}.`,
        progress: Math.round(((index + 1) / chunks.length) * 100),
      };
    }
    assertNotCancelled(job.abort.signal);
    if (fd === undefined || !fmt || dataBytes === 0) throw new Error('The selected voice model produced no audio to export.');
    writeSync(fd, wavHeader(fmt, dataBytes), 0, undefined, 0);
    closeSync(fd);
    fd = undefined;
    job.status = {
      ...job.status,
      bytes: statSync(job.path).size,
      downloadUrl: `/api/exports/${job.status.id}/file`,
      durationSeconds: byteRate > 0 ? Number((dataBytes / byteRate).toFixed(1)) : undefined,
      message: 'Voice file ready to save.',
      progress: 100,
      state: 'ready',
    };
  } catch (error) {
    if (fd !== undefined) closeSync(fd);
    rmSync(job.path, { force: true });
    const cancelled = job.abort.signal.aborted;
    job.status = {
      ...job.status,
      error: cancelled ? undefined : (error as Error).message,
      message: cancelled ? 'Voice file export cancelled.' : `Voice export failed: ${(error as Error).message}`,
      state: cancelled ? 'cancelled' : 'error',
    };
  }
}

function readWavPart(path: string): WavPart {
  const wav = readFileSync(path);
  if (wav.length < 44 || wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('The selected voice model produced an invalid WAV part.');
  }
  let offset = 12;
  let fmt: Buffer | undefined;
  let data: Buffer | undefined;
  while (offset + 8 <= wav.length) {
    const name = wav.toString('ascii', offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + size;
    if (end > wav.length) throw new Error('The selected voice model produced a truncated WAV part.');
    if (name === 'fmt ') fmt = Buffer.from(wav.subarray(start, end));
    if (name === 'data') {
      data = Buffer.from(wav.subarray(start, end));
      break;
    }
    offset = end + (size % 2);
  }
  if (!fmt || fmt.length < 16 || !data?.length) throw new Error('The selected voice model produced an incomplete WAV part.');
  const format = fmt.readUInt16LE(0);
  const channels = fmt.readUInt16LE(2);
  const sampleRate = fmt.readUInt32LE(4);
  const byteRate = fmt.readUInt32LE(8);
  const bitsPerSample = fmt.readUInt16LE(14);
  if (format !== 1 || channels !== 1 || sampleRate !== 24_000 || bitsPerSample !== 16 || byteRate !== 48_000) {
    throw new Error('The selected voice model produced an unsupported WAV format.');
  }
  return { byteRate, data, fmt };
}

function wavHeader(fmt: Buffer, dataBytes: number): Buffer {
  const fmtPadding = fmt.length % 2;
  const header = Buffer.alloc(12 + 8 + fmt.length + fmtPadding + 8);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(header.length - 8 + dataBytes, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(fmt.length, 16);
  fmt.copy(header, 20);
  const dataOffset = 20 + fmt.length + fmtPadding;
  header.write('data', dataOffset, 'ascii');
  header.writeUInt32LE(dataBytes, dataOffset + 4);
  return header;
}

function selectedExportVoice(engine: SpeechEngine, voice?: string): string {
  if (String(voice ?? '').trim().toLowerCase() !== RANDOM_VOICE) return normalizeEngineVoice(engine, voice);
  const voices = engineVoiceOptions(engine);
  return voices[Math.floor(Math.random() * voices.length)]?.id ?? normalizeEngineVoice(engine);
}

function exportFilename(value?: string): string {
  const base = String(value ?? '')
    .replace(/\.wav$/i, '')
    .replace(/[^a-z0-9 _.-]+/gi, '')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 80);
  if (base) return `${base}.wav`;
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
  return `Kokoro reading ${stamp}.wav`;
}

function prepareExportDirectory(dir: string): void {
  mkdirSync(dir, { mode: 0o700, recursive: true });
  const cutoff = Date.now() - EXPORT_MAX_AGE_MS;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    try {
      if (!name.endsWith('.wav') || statSync(path).mtimeMs < cutoff) rmSync(path, { force: true });
    } catch {}
  }
}

function assertNotCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new Error('Voice file export cancelled.');
}
