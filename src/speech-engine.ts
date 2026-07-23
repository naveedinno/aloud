import { cpus, totalmem } from 'node:os';
import {
  createManagedKokoroSynthesizer,
  kokoroVoiceLabel,
  kokoroVoiceOptions,
  normalizeKokoroVoice,
} from './kokoro-tts.js';
import {
  createManagedPocketSynthesizer,
  normalizePocketVoice,
  pocketVoiceLabel,
  pocketVoiceOptions,
} from './pocket-tts.js';

export type SpeechEngine = 'kokoro' | 'pocket';

export interface SpeechSynthesisRequest {
  engine?: SpeechEngine;
  rate?: number;
  text: string;
  voice?: string;
}

export interface SpeechSynthesisResult {
  cached: boolean;
  dir: string;
  engine: SpeechEngine;
  id: string;
  path: string;
  rate: number;
  url: string;
  voice: string;
}

export type SpeechSynthesizer = (
  home: string,
  input: SpeechSynthesisRequest,
  options?: { signal?: AbortSignal },
) => Promise<SpeechSynthesisResult>;

export interface ManagedSpeechSynthesizer {
  dispose(): void;
  synthesize: SpeechSynthesizer;
}

export function normalizeSpeechEngine(engine?: string): SpeechEngine {
  return String(engine ?? '').toLowerCase().trim() === 'pocket' ? 'pocket' : 'kokoro';
}

export function normalizeEngineVoice(engine: SpeechEngine, voice?: string): string {
  return engine === 'pocket' ? normalizePocketVoice(voice) : normalizeKokoroVoice(voice);
}

export function engineVoiceLabel(engine: SpeechEngine, voice?: string): string {
  return engine === 'pocket' ? pocketVoiceLabel(voice) : kokoroVoiceLabel(voice);
}

export function engineVoiceOptions(engine: SpeechEngine): Array<{ id: string; label: string; description: string }> {
  return engine === 'pocket' ? pocketVoiceOptions() : kokoroVoiceOptions();
}

export function recommendedKokoroWorkers(
  memoryBytes = totalmem(),
  logicalCores = cpus().length,
): number {
  return memoryBytes >= 16 * 1024 ** 3 && logicalCores >= 8 ? 2 : 1;
}

export function createManagedSpeechSynthesizer(home: string): ManagedSpeechSynthesizer {
  const kokoro = createManagedKokoroSynthesizer(home, { workers: recommendedKokoroWorkers() });
  const pocket = createManagedPocketSynthesizer(home);
  return {
    async synthesize(_home, input, options = {}) {
      const engine = normalizeSpeechEngine(input.engine);
      if (engine === 'pocket') {
        const result = await pocket.synthesize({
          rate: input.rate,
          text: input.text,
          voice: input.voice,
        }, options);
        return { ...result, engine };
      }
      const result = await kokoro.synthesize({
        rate: input.rate,
        text: input.text,
        voice: input.voice,
      }, options);
      return { ...result, engine };
    },
    dispose() {
      kokoro.dispose();
      pocket.dispose();
    },
  };
}
