import assert from 'node:assert/strict';
import test from 'node:test';
import {
  controllerWindowCommand,
  nativeSpeechOverlaySource,
  speechControllerHtml,
  startSpeechController,
} from '../dist/controller.js';

test('speech controller HTML presents progress and stop controls', () => {
  const html = speechControllerHtml();
  assert.match(html, /Aloud/);
  assert.match(html, /id="stop"/);
  assert.match(html, />Stop</);
  assert.match(html, /id="bar"/);
  assert.match(html, /width: 420px/);
  assert.match(html, /height: 190px/);
  assert.match(html, /data-rate="0.8"/);
  assert.match(html, /data-rate="1.25"/);
  assert.match(html, /fetch\('stop'/);
  assert.match(html, /fetch\('state'/);
  assert.match(html, /fetch\('rate'/);
  assert.match(html, /class="status-dot"/);
  assert.match(html, /id="retry"/);
  assert.match(html, /role="progressbar"/);
  assert.match(html, /aria-valuetext/);
  assert.match(html, /aria-pressed="true"/);
  assert.match(html, /renderConnectionLost/);
  assert.match(html, /if \(refreshInFlight\) return/);
  assert.match(html, /statusLabel\.replaceChildren/);
  assert.doesNotMatch(html, /statusLabel\.innerHTML/);
});

test('speech controller uses a capability URL and rejects unsafe requests', async () => {
  const controller = await startSpeechController({ onStop() {}, openWindow: false });
  try {
    const url = new URL(controller.url);
    assert.match(url.pathname, /^\/[A-Za-z0-9_-]{32}\/$/);

    const state = await fetch(new URL('state', url));
    assert.equal(state.status, 200);

    const unscoped = await fetch(new URL('/state', url));
    assert.equal(unscoped.status, 404);

    const crossOrigin = await fetch(new URL('state', url), { headers: { Origin: 'https://example.com' } });
    assert.equal(crossOrigin.status, 403);

    const wrongType = await fetch(new URL('rate', url), { method: 'POST', body: '{}' });
    assert.equal(wrongType.status, 415);

    const tooLarge = await fetch(new URL('rate', url), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ padding: 'x'.repeat(5_000), rate: 1 }),
    });
    assert.equal(tooLarge.status, 413);
  } finally {
    controller.close();
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
});

test('controller window prefers the native macOS overlay when available', () => {
  assert.deepEqual(controllerWindowCommand('http://127.0.0.1:1234', {
    nativeOverlayExecutable: '/tmp/AloudOverlay',
    platform: 'darwin',
  }), {
    command: '/tmp/AloudOverlay',
    args: ['http://127.0.0.1:1234'],
  });
});

test('native macOS overlay is transparent and floats above other apps', () => {
  const source = nativeSpeechOverlaySource();
  assert.match(source, /NSPanel/);
  assert.match(source, /NSApp\.setActivationPolicy\(\.accessory\)/);
  assert.match(source, /panel\.backgroundColor = \.clear/);
  assert.match(source, /panel\.isOpaque = false/);
  assert.match(source, /panel\.level = \.floating/);
  assert.match(source, /panel\.hasShadow = false/);
  assert.match(source, /\.canJoinAllSpaces/);
  assert.match(source, /\.fullScreenAuxiliary/);
  assert.match(source, /NSVisualEffectView/);
  assert.match(source, /surface\.layer\?\.shadowRadius = 18/);
  assert.match(source, /blur\.layer\?\.cornerCurve = \.continuous/);
  assert.match(source, /blur\.layer\?\.masksToBounds = true/);
});

test('native macOS overlay exposes live speed controls and aligned status indicator', () => {
  const source = nativeSpeechOverlaySource();
  assert.match(source, /let rate: Double\?/);
  assert.match(source, /rateURL = baseURL\.appendingPathComponent\("rate"\)/);
  assert.match(source, /speedRates: \[Double\] = \[0\.8, 1\.0, 1\.25\]/);
  assert.match(source, /makeSpeedButton/);
  assert.match(source, /setSpeed/);
  assert.match(source, /activityDot/);
  assert.doesNotMatch(source, /activityBars/);
  assert.match(source, /setAccessibilityLabel\("Reading speed/);
  assert.match(source, /setAccessibilityValue\(isSelected \? "Selected" : "Not selected"\)/);
  assert.match(source, /setAccessibilityRole\(\.progressIndicator\)/);
  assert.match(source, /setAccessibilityHelp\(total > 0/);
});

test('native macOS overlay keeps connection loss recoverable', () => {
  const source = nativeSpeechOverlaySource();
  assert.match(source, /retryButton/);
  assert.match(source, /retryConnection/);
  assert.match(source, /renderConnectionLost/);
  assert.match(source, /The playback controller lost its local connection/);
  assert.match(source, /messageLabel\.frame\.size\.width = 225/);
  assert.match(source, /queueClose\(after: 5\.5\)/);
  assert.match(source, /queueClose\(after: 3\.2\)/);
  assert.match(source, /if pollInFlight \{ return \}/);
  assert.doesNotMatch(source, /failedPolls > 8 \{ NSApp\.terminate/);
});

test('browser controller keeps every terminal state visible before closing', () => {
  const html = speechControllerHtml();
  assert.match(html, /state\.status === 'done' \? 1400 : state\.status === 'stopped' \? 3200 : 5500/);
});

test('controller window falls back to a compact isolated Chrome app on macOS', () => {
  assert.deepEqual(controllerWindowCommand('http://127.0.0.1:1234', {
    chromeExecutable: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    platform: 'darwin',
    userDataDir: '/tmp/kokoro-test-profile',
  }), {
    command: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: [
      '--app=http://127.0.0.1:1234',
      '--new-window',
      '--no-first-run',
      '--disable-extensions',
      '--user-data-dir=/tmp/kokoro-test-profile',
      '--window-size=420,190',
      '--window-position=112,112',
    ],
  });
});

test('controller window falls back to the default browser on macOS', () => {
  assert.deepEqual(controllerWindowCommand('http://127.0.0.1:1234', {
    chromeExecutable: '',
    platform: 'darwin',
  }), {
    command: '/usr/bin/open',
    args: ['http://127.0.0.1:1234'],
  });
});
