import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_READER_TEXT_CHARACTERS, renderPage } from '../dist/page.js';

test('reader starts in an honest connecting state and locks actions until reachable', () => {
  const html = renderPage();
  assert.equal(MAX_READER_TEXT_CHARACTERS, 240_000);
  assert.match(html, /class="connection is-connecting"/);
  assert.match(html, /data-retry-reader hidden/);
  assert.match(html, /data-play[^>]+disabled/);
  assert.match(html, /readerReachable = false/);
  assert.match(html, /setAttribute\('aria-busy', requestBusy \? 'true' : 'false'\)/);
  assert.match(html, /text\.readOnly = replacingLocked/);
  assert.match(html, /clearHistoryButton\.disabled = replacingLocked/);
  assert.match(html, /button\.disabled = replacingLocked/);
});

test('reader derives its active chunk locally and preserves keyboard focus', () => {
  const html = renderPage();
  assert.doesNotMatch(html, /state\.chunkText/);
  assert.match(html, /next\.jobId !== ownedJobId/);
  assert.match(html, /ownedJobId = next && next\.jobId \? next\.jobId : null/);
  assert.match(html, /Number\.isInteger\(start\)/);
  assert.match(html, /source\.slice\(start, end\)/);
  assert.match(html, /document\.activeElement === text/);
  assert.match(html, /readingView\.focus\(\{ preventScroll: true \}\)/);
  assert.match(html, /text\.focus\(\{ preventScroll: true \}\)/);
  assert.match(html, /readingHadFocus \|\| \(restoreEditorFocus && document\.activeElement === document\.body\)/);
  assert.match(html, /focusBeforeRequest\.focus\(\{ preventScroll: true \}\)/);
  assert.match(html, /if\(restoreControlFocus\) restoreEditorFocus = false/);
  assert.match(html, /var value = text\.value \|\| ''/);
  assert.doesNotMatch(html, /var value = \(text\.value \|\| ''\)\.trim\(\)/);
});

test('reader safeguards document replacement and exposes recoverable failures', () => {
  const html = renderPage();
  assert.match(html, /armEditorUndo\(previousValue, undoAction\)/);
  assert.match(html, /Undo is available for a few seconds/);
  assert.match(html, /Restore “' \+ itemTitle \+ '”/);
  assert.match(html, /Mac connection checks are unavailable/);
  assert.match(html, /firstFailure && readerReachable && !isPlaybackRunning\(\)/);
  assert.match(html, /data-health-retry/);
  assert.match(html, /Reading history cleared/);
  assert.match(html, /data-cache-row hidden/);
  assert.match(html, /post\('\/api\/system\/cache', \{ action: 'clear' \}\)/);
});

test('reader polling pauses in the background and prevents overlapping requests', () => {
  const html = renderPage();
  assert.match(html, /if\(statusPollInFlight\) return statusPollInFlight/);
  assert.match(html, /if\(healthPollInFlight\) return healthPollInFlight/);
  assert.match(html, /STATUS_ACTIVE_POLL_MS = 750/);
  assert.match(html, /STATUS_IDLE_POLL_MS = 5000/);
  assert.match(html, /HEALTH_READY_POLL_MS = 60000/);
  assert.match(html, /setTimeout\(runStatusPoll, delay\)/);
  assert.doesNotMatch(html, /setInterval\(/);
  assert.match(html, /visibilitychange/);
});

test('reader keeps controls usable when browser storage is unavailable', () => {
  const html = renderPage();
  assert.match(html, /function readStorage\(key, fallback\)/);
  assert.match(html, /function writeStorage\(key, value\)/);
  assert.match(html, /function removeStorage\(key\)/);
  assert.match(html, /Draft saving and reading history are unavailable/);
  assert.doesNotMatch(html, /(?<!window\.)localStorage\.(getItem|setItem|removeItem)/);
});

test('narrow layouts keep playback controls visible from the start', () => {
  const html = renderPage();
  assert.match(html, /@media \(max-width: 620px\)[\s\S]+?\.player-shell \{[\s\S]+?position: fixed/);
  assert.match(html, /bottom: max\(8px, env\(safe-area-inset-bottom\)\)/);
});

test('essential empty-editor guidance meets the intended contrast treatment', () => {
  const html = renderPage();
  assert.match(html, /textarea::placeholder \{ color: #818b88; \}/);
  assert.doesNotMatch(html, /textarea::placeholder \{ color: #6f7775; \}/);
});
