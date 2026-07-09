import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/daemon.ts', import.meta.url), 'utf8');

test('speech daemon tracks menu bar voice selection for plain reads', () => {
  assert.match(source, /const RANDOM_VOICE = 'random'/);
  assert.match(source, /let currentMode: SpeechMode = 'auto'/);
  assert.match(source, /request\.method === 'POST' && request\.url === '\/mode'/);
  assert.match(source, /request\.method === 'POST' && request\.url === '\/pause'/);
  assert.match(source, /request\.method === 'POST' && request\.url === '\/resume'/);
  assert.match(source, /currentMode = speechMode\(body\.mode\)/);
  assert.match(source, /currentMode = speechMode\(body\.mode \?\? currentMode\)/);
  assert.match(source, /mode: currentMode/);
  assert.match(source, /modeLabel: speechModeLabel\(currentMode\)/);
  assert.match(source, /let currentVoice = normalizeDaemonVoice\('af_heart'\)/);
  assert.match(source, /request\.method === 'POST' && request\.url === '\/voice'/);
  assert.match(source, /currentVoice = normalizeDaemonVoice\(body\.voice\)/);
  assert.match(source, /currentVoice = normalizeDaemonVoice\(body\.voice \?\? currentVoice\)/);
  assert.match(source, /const jobInput: SpeechDaemonRequest = \{ \.\.\.body, mode: currentMode, voice: selectedDaemonVoice\(currentVoice\) \}/);
  assert.match(source, /function daemonVoiceLabel/);
  assert.match(source, /function selectedDaemonVoice/);
  assert.match(source, /currentPlayback\?\.pause\(\)/);
  assert.match(source, /currentPlayback\?\.resume\(\)/);
});

test('speech daemon does not open the old overlay controller', () => {
  assert.doesNotMatch(source, /startSpeechController/);
  assert.doesNotMatch(source, /SpeechController,/);
  assert.doesNotMatch(source, /currentController/);
});
