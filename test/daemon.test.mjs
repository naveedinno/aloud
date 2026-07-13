import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/daemon.ts', import.meta.url), 'utf8');

test('speech daemon tracks menu bar voice selection for plain reads', () => {
  assert.match(source, /const RANDOM_VOICE = 'random'/);
  assert.match(source, /loadReaderPreferences\(home\)/);
  assert.match(source, /let currentMode: SpeechMode = speechMode\(storedPreferences\.mode/);
  assert.match(source, /request\.method === 'POST' && request\.url === '\/mode'/);
  assert.match(source, /request\.method === 'POST' && request\.url === '\/pause'/);
  assert.match(source, /request\.method === 'POST' && request\.url === '\/resume'/);
  assert.match(source, /currentMode = speechMode\(body\.mode\)/);
  assert.match(source, /currentMode = speechMode\(body\.mode \?\? currentMode\)/);
  assert.match(source, /mode: currentMode/);
  assert.match(source, /modeLabel: speechModeLabel\(currentMode\)/);
  assert.match(source, /let currentVoice = normalizeDaemonVoice\(storedPreferences\.voice/);
  assert.match(source, /request\.method === 'POST' && request\.url === '\/voice'/);
  assert.match(source, /currentVoice = normalizeDaemonVoice\(body\.voice\)/);
  assert.match(source, /currentVoice = normalizeDaemonVoice\(body\.voice \?\? currentVoice\)/);
  assert.match(source, /voice: selectedDaemonVoice\(currentVoice\)/);
  assert.match(source, /function daemonVoiceLabel/);
  assert.match(source, /function selectedDaemonVoice/);
  assert.match(source, /currentPlayback\?\.pause\(\)/);
  assert.match(source, /currentPlayback\?\.resume\(\)/);
  assert.match(source, /request\.url === '\/settings'/);
  assert.match(source, /request\.url === '\/seek'/);
  assert.match(source, /chunkText:/);
  assert.match(source, /speechChunkRanges\(input\.text, chunks\)/);
  assert.match(source, /chunkStart: range\?\.start/);
  assert.match(source, /chunkEnd: range\?\.end/);
  assert.match(source, /speechPrefetchForMode\(input\.mode\)/);
  assert.match(source, /normalizeGlobalShortcut/);
  assert.match(source, /saveReaderPreferences/);
});

test('speech daemon does not open the old overlay controller', () => {
  assert.doesNotMatch(source, /startSpeechController/);
  assert.doesNotMatch(source, /SpeechController,/);
  assert.doesNotMatch(source, /currentController/);
});

test('speech daemon keeps Kokoro model workers out of idle memory', () => {
  assert.doesNotMatch(source, /warmKokoroWorkers/);
  assert.doesNotMatch(source, /createKokoroSynthesizerSession/);
  assert.match(source, /createManagedKokoroSynthesizer\(home, \{ workers: 1 \}\)/);
  assert.match(source, /server\.on\('close', \(\) => synthesizer\.dispose\(\)\)/);
});

test('speech daemon finishes cancellation before starting the replacement job', () => {
  assert.match(source, /stopCurrent\(\);\s+await currentJob;/);
  assert.match(source, /if \(currentJob === job\)/);
});
