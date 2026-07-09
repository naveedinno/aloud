import assert from 'node:assert/strict';
import test from 'node:test';
import {
  controllerWindowCommand,
  nativeSpeechOverlaySource,
  speechControllerHtml,
} from '../dist/controller.js';

test('speech controller HTML presents progress and stop controls', () => {
  const html = speechControllerHtml();
  assert.match(html, /Kokoro Reader/);
  assert.match(html, /id="stop"/);
  assert.match(html, />Stop</);
  assert.match(html, /id="bar"/);
  assert.match(html, /width: 420px/);
  assert.match(html, /height: 190px/);
  assert.match(html, /data-rate="0.8"/);
  assert.match(html, /data-rate="1.25"/);
  assert.match(html, /fetch\('\/stop'/);
  assert.match(html, /fetch\('\/state'/);
  assert.match(html, /fetch\('\/rate'/);
  assert.match(html, /class="status-dot"/);
});

test('controller window prefers the native macOS overlay when available', () => {
  assert.deepEqual(controllerWindowCommand('http://127.0.0.1:1234', {
    nativeOverlayExecutable: '/tmp/KokoroReaderOverlay',
    platform: 'darwin',
  }), {
    command: '/tmp/KokoroReaderOverlay',
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
