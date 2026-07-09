import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { kokoroRate, kokoroReaderSupportDir } from './kokoro-tts.js';

export type SpeechControllerStatus = 'starting' | 'generating' | 'reading' | 'done' | 'stopped' | 'error';

export interface SpeechControllerState {
  current?: number;
  message?: string;
  rate?: number;
  status: SpeechControllerStatus;
  total?: number;
}

export interface SpeechController {
  close(afterMs?: number): void;
  update(state: Partial<SpeechControllerState>): void;
  url: string;
}

interface SpeechControllerOptions {
  initialRate?: number;
  onRate?: (rate: number) => void;
  onStop: () => void;
  openWindow?: boolean;
}

const DEFAULT_STATE: SpeechControllerState = {
  message: 'Preparing selected text',
  rate: 1,
  status: 'starting',
};
const WINDOW_WIDTH = 420;
const WINDOW_HEIGHT = 190;
const WINDOW_X = 112;
const WINDOW_Y = 112;
const OVERLAY_WIDTH = 416;
const OVERLAY_HEIGHT = 136;
const OVERLAY_RADIUS = 18;
const NATIVE_OVERLAY_SWIFT = String.raw`import AppKit
import Foundation

struct ControllerState: Decodable {
    let current: Int?
    let message: String?
    let rate: Double?
    let status: String
    let total: Int?
}

final class OverlayController: NSObject, NSApplicationDelegate {
    private let baseURL: URL
    private let rateURL: URL
    private let stateURL: URL
    private let stopURL: URL
    private var panel: NSPanel!
    private var titleLabel: NSTextField!
    private var messageLabel: NSTextField!
    private var statusLabel: NSTextField!
    private var countLabel: NSTextField!
    private var progressTrack: NSView!
    private var progressBar: NSView!
    private var speedTray: NSView!
    private var stopButton: NSButton!
    private var speedButtons: [NSButton] = []
    private var activityDot: NSView!
    private let speedRates: [Double] = [0.8, 1.0, 1.25]
    private var doneTimer: Timer?
    private var failedPolls = 0

    init(baseURL: URL) {
        self.baseURL = baseURL
        self.rateURL = baseURL.appendingPathComponent("rate")
        self.stateURL = baseURL.appendingPathComponent("state")
        self.stopURL = baseURL.appendingPathComponent("stop")
        super.init()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        buildPanel()
        poll()
        Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in
            self?.poll()
        }
    }

    private func buildPanel() {
        let screen = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        let frame = NSRect(
            x: screen.maxX - ${OVERLAY_WIDTH} - 24,
            y: screen.maxY - ${OVERLAY_HEIGHT} - 24,
            width: ${OVERLAY_WIDTH},
            height: ${OVERLAY_HEIGHT}
        )

        panel = NSPanel(
            contentRect: frame,
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.backgroundColor = .clear
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .transient]
        panel.hasShadow = false
        panel.hidesOnDeactivate = false
        panel.isMovableByWindowBackground = true
        panel.isOpaque = false
        panel.level = .floating
        panel.orderFrontRegardless()

        let root = NSView(frame: NSRect(x: 0, y: 0, width: ${OVERLAY_WIDTH}, height: ${OVERLAY_HEIGHT}))
        root.wantsLayer = true
        root.layer?.backgroundColor = NSColor.clear.cgColor
        panel.contentView = root

        let surface = NSView(frame: NSRect(x: 1, y: 1, width: ${OVERLAY_WIDTH - 2}, height: ${OVERLAY_HEIGHT - 2}))
        surface.wantsLayer = true
        surface.layer?.backgroundColor = NSColor.clear.cgColor
        surface.layer?.cornerRadius = ${OVERLAY_RADIUS}
        surface.layer?.cornerCurve = .continuous
        surface.layer?.masksToBounds = false
        surface.layer?.shadowColor = NSColor.black.cgColor
        surface.layer?.shadowOffset = CGSize(width: 0, height: -6)
        surface.layer?.shadowOpacity = 0.24
        surface.layer?.shadowRadius = 18
        root.addSubview(surface)

        let blur = NSVisualEffectView(frame: surface.bounds)
        blur.blendingMode = .behindWindow
        blur.material = .hudWindow
        blur.state = .active
        blur.wantsLayer = true
        blur.layer?.backgroundColor = NSColor.windowBackgroundColor.withAlphaComponent(0.18).cgColor
        blur.layer?.borderColor = NSColor.white.withAlphaComponent(0.18).cgColor
        blur.layer?.borderWidth = 0.5
        blur.layer?.cornerRadius = ${OVERLAY_RADIUS}
        blur.layer?.cornerCurve = .continuous
        blur.layer?.masksToBounds = true
        surface.addSubview(blur)

        titleLabel = label("Kokoro Reader", x: 18, y: 100, width: 210, height: 18, size: 13, weight: .semibold, color: NSColor.white.withAlphaComponent(0.94))
        messageLabel = label("Preparing selected text", x: 18, y: 79, width: 288, height: 18, size: 12, weight: .regular, color: NSColor.white.withAlphaComponent(0.66))
        statusLabel = label("Starting", x: 38, y: 14, width: 150, height: 16, size: 11, weight: .medium, color: NSColor.white.withAlphaComponent(0.58))
        countLabel = label("", x: 346, y: 14, width: 52, height: 16, size: 11, weight: .medium, color: NSColor.white.withAlphaComponent(0.58), alignment: .right)

        progressTrack = NSView(frame: NSRect(x: 18, y: 66, width: ${OVERLAY_WIDTH - 36}, height: 5))
        progressTrack.wantsLayer = true
        progressTrack.layer?.backgroundColor = NSColor.white.withAlphaComponent(0.16).cgColor
        progressTrack.layer?.cornerRadius = 2.5

        progressBar = NSView(frame: NSRect(x: 0, y: 0, width: 28, height: 5))
        progressBar.wantsLayer = true
        progressBar.layer?.backgroundColor = NSColor(red: 0.42, green: 0.86, blue: 0.78, alpha: 0.95).cgColor
        progressBar.layer?.cornerRadius = 2.5
        progressTrack.addSubview(progressBar)

        speedTray = NSView(frame: NSRect(x: 184, y: 9, width: 150, height: 28))
        speedTray.wantsLayer = true
        speedTray.layer?.backgroundColor = NSColor.black.withAlphaComponent(0.16).cgColor
        speedTray.layer?.borderColor = NSColor.white.withAlphaComponent(0.07).cgColor
        speedTray.layer?.borderWidth = 0.5
        speedTray.layer?.cornerRadius = 10

        stopButton = NSButton(frame: NSRect(x: 330, y: 90, width: 68, height: 28))
        stopButton.title = "Stop"
        stopButton.target = self
        stopButton.action = #selector(stopOrClose)
        stopButton.bezelStyle = .regularSquare
        stopButton.isBordered = false
        stopButton.wantsLayer = true
        stopButton.layer?.backgroundColor = NSColor(red: 0.78, green: 0.25, blue: 0.21, alpha: 0.94).cgColor
        stopButton.layer?.cornerRadius = 8
        stopButton.contentTintColor = .white
        stopButton.font = NSFont.systemFont(ofSize: 12, weight: .semibold)

        activityDot = NSView(frame: NSRect(x: 22, y: 19, width: 6, height: 6))
        activityDot.wantsLayer = true
        activityDot.layer?.backgroundColor = NSColor(red: 0.42, green: 0.86, blue: 0.78, alpha: 0.78).cgColor
        activityDot.layer?.cornerRadius = 3
        blur.addSubview(activityDot)

        for (index, rate) in speedRates.enumerated() {
            let button = makeSpeedButton(title: speedTitle(rate), rate: rate, x: 190 + CGFloat(index * 48))
            speedButtons.append(button)
            blur.addSubview(button)
        }

        blur.addSubview(titleLabel)
        blur.addSubview(messageLabel)
        blur.addSubview(progressTrack)
        blur.addSubview(speedTray, positioned: .below, relativeTo: speedButtons.first)
        blur.addSubview(statusLabel)
        blur.addSubview(countLabel)
        blur.addSubview(stopButton)
    }

    private func label(_ value: String, x: CGFloat, y: CGFloat, width: CGFloat, height: CGFloat, size: CGFloat, weight: NSFont.Weight, color: NSColor, alignment: NSTextAlignment = .left) -> NSTextField {
        let field = NSTextField(frame: NSRect(x: x, y: y, width: width, height: height))
        field.alignment = alignment
        field.backgroundColor = .clear
        field.drawsBackground = false
        field.font = NSFont.systemFont(ofSize: size, weight: weight)
        field.isBezeled = false
        field.isEditable = false
        field.isSelectable = false
        field.lineBreakMode = .byTruncatingTail
        field.stringValue = value
        field.textColor = color
        return field
    }

    private func makeSpeedButton(title: String, rate: Double, x: CGFloat) -> NSButton {
        let button = NSButton(frame: NSRect(x: x, y: 12, width: 42, height: 22))
        button.title = title
        button.tag = Int(round(rate * 100))
        button.target = self
        button.action = #selector(setSpeed(_:))
        button.bezelStyle = .regularSquare
        button.isBordered = false
        button.wantsLayer = true
        button.layer?.cornerRadius = 7
        button.font = NSFont.systemFont(ofSize: 11, weight: .semibold)
        return button
    }

    private func speedTitle(_ rate: Double) -> String {
        if abs(rate - 1.0) < 0.001 { return "1x" }
        if rate < 1 { return String(format: "%.1fx", rate) }
        return String(format: "%.2fx", rate)
    }

    @objc private func setSpeed(_ sender: NSButton) {
        let rate = Double(sender.tag) / 100.0
        renderSpeed(rate)
        var request = URLRequest(url: rateURL)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = "{\"rate\":\(rate)}".data(using: .utf8)
        URLSession.shared.dataTask(with: request) { [weak self] _, _, _ in
            DispatchQueue.main.async { self?.poll() }
        }.resume()
    }

    private func renderSpeed(_ rate: Double) {
        let selected = Int(round(rate * 100))
        for button in speedButtons {
            let isSelected = abs(button.tag - selected) <= 3
            if isSelected {
                button.layer?.backgroundColor = NSColor(red: 0.42, green: 0.86, blue: 0.78, alpha: 0.22).cgColor
                button.layer?.borderColor = NSColor(red: 0.42, green: 0.86, blue: 0.78, alpha: 0.55).cgColor
            } else {
                button.layer?.backgroundColor = NSColor.white.withAlphaComponent(0.10).cgColor
                button.layer?.borderColor = NSColor.white.withAlphaComponent(0.08).cgColor
            }
            button.layer?.borderWidth = 0.5
            button.contentTintColor = isSelected ? .white : NSColor.white.withAlphaComponent(0.68)
        }
    }

    @objc private func stopOrClose() {
        if stopButton.title == "Close" {
            NSApp.terminate(nil)
            return
        }
        stopButton.title = "Stopping"
        stopButton.isEnabled = false
        var request = URLRequest(url: stopURL)
        request.httpMethod = "POST"
        URLSession.shared.dataTask(with: request) { [weak self] _, _, _ in
            DispatchQueue.main.async {
                self?.stopButton.isEnabled = true
                self?.poll()
            }
        }.resume()
    }

    private func poll() {
        URLSession.shared.dataTask(with: stateURL) { [weak self] data, _, error in
            guard let self else { return }
            if error != nil || data == nil {
                DispatchQueue.main.async {
                    self.failedPolls += 1
                    if self.failedPolls > 8 { NSApp.terminate(nil) }
                }
                return
            }
            do {
                let state = try JSONDecoder().decode(ControllerState.self, from: data!)
                DispatchQueue.main.async {
                    self.failedPolls = 0
                    self.render(state)
                }
            } catch {
                DispatchQueue.main.async {
                    self.failedPolls += 1
                    if self.failedPolls > 8 { NSApp.terminate(nil) }
                }
            }
        }.resume()
    }

    private func render(_ state: ControllerState) {
        messageLabel.stringValue = state.message ?? ""
        statusLabel.stringValue = state.status.prefix(1).uppercased() + state.status.dropFirst()
        renderSpeed(state.rate ?? 1.0)

        let total = max(state.total ?? 0, 0)
        let current = max(state.current ?? 0, 0)
        countLabel.stringValue = total > 1 ? "\(min(current, total)) / \(total)" : ""

        let ratio = total > 0 ? max(0.08, min(1, Double(current) / Double(total))) : 0.08
        progressBar.frame.size.width = CGFloat(ratio) * progressTrack.bounds.width

        if state.status == "error" {
            progressBar.layer?.backgroundColor = NSColor(red: 0.86, green: 0.36, blue: 0.32, alpha: 0.95).cgColor
            stopAnimation()
        } else if state.status == "done" {
            progressBar.layer?.backgroundColor = NSColor(red: 0.42, green: 0.86, blue: 0.50, alpha: 0.95).cgColor
            stopAnimation()
            queueClose()
        } else if state.status == "stopped" {
            progressBar.layer?.backgroundColor = NSColor.white.withAlphaComponent(0.24).cgColor
            stopAnimation()
        } else {
            progressBar.layer?.backgroundColor = NSColor(red: 0.42, green: 0.86, blue: 0.78, alpha: 0.95).cgColor
            startAnimation(status: state.status)
        }

        if state.status == "stopped" || state.status == "done" || state.status == "error" {
            stopButton.title = "Close"
            stopButton.isEnabled = true
        }
    }

    private func startAnimation(status: String) {
        let activeColor: NSColor
        if status == "reading" {
            activeColor = NSColor(red: 0.42, green: 0.86, blue: 0.50, alpha: 0.88)
        } else {
            activeColor = NSColor(red: 0.42, green: 0.86, blue: 0.78, alpha: 0.82)
        }
        activityDot.isHidden = false
        activityDot.alphaValue = 1
        activityDot.layer?.backgroundColor = activeColor.cgColor
    }

    private func stopAnimation() {
        activityDot.alphaValue = 0.48
        activityDot.layer?.backgroundColor = NSColor.white.withAlphaComponent(0.34).cgColor
    }

    private func queueClose() {
        if doneTimer != nil { return }
        doneTimer = Timer.scheduledTimer(withTimeInterval: 1.4, repeats: false) { _ in
            NSApp.terminate(nil)
        }
    }
}

guard CommandLine.arguments.count > 1, let baseURL = URL(string: CommandLine.arguments[1]) else {
    exit(2)
}

let app = NSApplication.shared
let delegate = OverlayController(baseURL: baseURL)
app.delegate = delegate
app.run()
`;

export async function startSpeechController(options: SpeechControllerOptions): Promise<SpeechController> {
  let state: SpeechControllerState = { ...DEFAULT_STATE, rate: kokoroRate(options.initialRate) };
  let stopped = false;
  let closeTimer: NodeJS.Timeout | undefined;

  const server = createServer(async (request, response) => {
    if (request.method === 'GET' && request.url === '/') return sendHtml(response);
    if (request.method === 'GET' && request.url === '/state') return sendJson(response, state);
    if (request.method === 'POST' && request.url === '/rate') {
      try {
        const body = await readJson<{ rate?: number }>(request);
        const rate = kokoroRate(body.rate);
        state = { ...state, rate };
        options.onRate?.(rate);
        return sendJson(response, state);
      } catch (err) {
        return sendJson(response, { error: (err as Error).message, ok: false }, 400);
      }
    }
    if (request.method === 'POST' && request.url === '/stop') {
      if (!stopped) {
        stopped = true;
        state = { ...state, message: 'Stopping playback', status: 'stopped' };
        options.onStop();
      }
      return sendJson(response, state);
    }
    response.writeHead(404).end();
  });

  const url = await listenLocal(server);
  const controller: SpeechController = {
    close(afterMs = 0) {
      if (closeTimer) clearTimeout(closeTimer);
      closeTimer = setTimeout(() => closeServer(server), afterMs);
      closeTimer.unref?.();
    },
    update(next) {
      state = { ...state, ...next };
    },
    url,
  };

  if (options.openWindow !== false) openControllerWindow(url);
  return controller;
}

export function controllerWindowCommand(
  url: string,
  opts: { chromeExecutable?: string; nativeOverlayExecutable?: string; platform?: NodeJS.Platform; userDataDir?: string } = {},
): { args: string[]; command: string } | undefined {
  const platform = opts.platform ?? process.platform;
  if (platform !== 'darwin') return undefined;
  if (opts.nativeOverlayExecutable) {
    return {
      command: opts.nativeOverlayExecutable,
      args: [url],
    };
  }
  const chrome = opts.chromeExecutable ?? chromeExecutable();
  if (chrome) {
    return {
      command: chrome,
      args: [
        `--app=${url}`,
        '--new-window',
        '--no-first-run',
        '--disable-extensions',
        `--user-data-dir=${opts.userDataDir ?? join('/tmp', 'kokoro-reader-controller-chrome')}`,
        `--window-size=${WINDOW_WIDTH},${WINDOW_HEIGHT}`,
        `--window-position=${WINDOW_X},${WINDOW_Y}`,
      ],
    };
  }
  return { command: '/usr/bin/open', args: [url] };
}

export function prepareNativeSpeechOverlay(home = homedir()): string | undefined {
  if (process.platform !== 'darwin') return undefined;
  const paths = nativeSpeechOverlayPaths(home);
  try {
    mkdirSync(paths.dir, { recursive: true });
    const oldSource = existsSync(paths.source) ? readFileSync(paths.source, 'utf8') : '';
    if (oldSource !== NATIVE_OVERLAY_SWIFT) writeFileSync(paths.source, NATIVE_OVERLAY_SWIFT, 'utf8');
    if (!existsSync(paths.executable) || oldSource !== NATIVE_OVERLAY_SWIFT) {
      const result = spawnSync('/usr/bin/swiftc', [paths.source, '-o', paths.executable], { encoding: 'utf8' });
      if (result.status !== 0) return undefined;
    }
    return paths.executable;
  } catch {
    return undefined;
  }
}

export function nativeSpeechOverlayPaths(home = homedir()): { dir: string; executable: string; source: string } {
  const dir = join(kokoroReaderSupportDir(home), 'controller');
  return {
    dir,
    executable: join(dir, 'KokoroReaderOverlay'),
    source: join(dir, 'KokoroReaderOverlay.swift'),
  };
}

export function nativeSpeechOverlaySource(): string {
  return NATIVE_OVERLAY_SWIFT;
}

export function speechControllerHtml(): string {
  return String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Kokoro Reader</title>
  <style>
    :root {
      color-scheme: dark;
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Arial, sans-serif;
      width: ${WINDOW_WIDTH}px;
      height: ${WINDOW_HEIGHT}px;
      overflow: hidden;
      background: #101312;
      color: #f3f5f2;
    }
    * { box-sizing: border-box; }
    html {
      width: ${WINDOW_WIDTH}px;
      height: ${WINDOW_HEIGHT}px;
      overflow: hidden;
      background: #101312;
    }
    body {
      margin: 0;
      width: ${WINDOW_WIDTH}px;
      height: ${WINDOW_HEIGHT}px;
      overflow: hidden;
      background:
        linear-gradient(180deg, rgba(255,255,255,0.035), rgba(255,255,255,0) 46%),
        #101312;
    }
    main {
      width: ${WINDOW_WIDTH}px;
      height: ${WINDOW_HEIGHT}px;
      padding: 16px 18px 14px;
    }
    .top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
      min-height: 36px;
    }
    h1 {
      margin: 0;
      font-size: 14px;
      font-weight: 650;
      letter-spacing: 0;
    }
    #message {
      margin-top: 3px;
      color: #a9b2ad;
      font-size: 12px;
      line-height: 1.35;
      min-height: 16px;
      max-width: 274px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    button {
      width: 66px;
      height: 30px;
      border: 0;
      border-radius: 7px;
      color: #fff8f5;
      background: #b9483f;
      box-shadow: inset 0 1px rgba(255,255,255,0.16), 0 8px 20px rgba(0,0,0,0.18);
      font-size: 12px;
      font-weight: 650;
      cursor: pointer;
    }
    button:focus-visible {
      outline: 2px solid #7fd7c8;
      outline-offset: 2px;
    }
    button:disabled {
      cursor: default;
      background: #343a3d;
      color: #aeb7b6;
      box-shadow: none;
    }
    .controls {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-top: 12px;
    }
    .speed {
      display: flex;
      gap: 6px;
    }
    .speed button {
      width: 48px;
      height: 26px;
      border-radius: 8px;
      background: rgba(255,255,255,0.08);
      box-shadow: inset 0 1px rgba(255,255,255,0.10);
      color: #bac4c0;
    }
    .speed button.is-active {
      background: rgba(88,196,183,0.22);
      color: #ffffff;
      box-shadow: inset 0 0 0 1px rgba(88,196,183,0.48);
    }
    .status-dot {
      display: inline-block;
      width: 6px;
      height: 6px;
      margin-right: 8px;
      border-radius: 99px;
      background: #58c4b7;
      vertical-align: 1px;
    }
    .meter {
      width: 100%;
      height: 6px;
      margin-top: 16px;
      overflow: hidden;
      border-radius: 999px;
      background: #242a28;
    }
    #bar {
      width: 8%;
      height: 100%;
      border-radius: inherit;
      background: #58c4b7;
      transition: width 180ms ease, background 180ms ease;
    }
    #detail {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      min-width: 156px;
      margin-top: 0;
      color: #87918c;
      font-size: 11px;
      min-height: 14px;
    }
  </style>
</head>
<body>
  <main>
    <div class="top">
      <div>
        <h1>Kokoro Reader</h1>
        <div id="message">Preparing selected text</div>
      </div>
      <button id="stop" type="button">Stop</button>
    </div>
    <div class="meter" aria-hidden="true"><div id="bar"></div></div>
    <div class="controls">
      <div class="speed" aria-label="Speech speed">
        <button type="button" data-rate="0.8">0.8x</button>
        <button type="button" data-rate="1">1x</button>
        <button type="button" data-rate="1.25">1.25x</button>
      </div>
      <div id="detail"><span id="status"><span class="status-dot"></span>Starting</span><span id="count"></span></div>
    </div>
  </main>
  <script>
    const stop = document.getElementById('stop');
    const message = document.getElementById('message');
    const statusLabel = document.getElementById('status');
    const count = document.getElementById('count');
    const bar = document.getElementById('bar');
    const rateButtons = Array.from(document.querySelectorAll('[data-rate]'));
    let closeQueued = false;

    function titleCase(value) {
      return String(value || 'starting').replace(/^./, (c) => c.toUpperCase());
    }

    function render(state) {
      message.textContent = state.message || '';
      statusLabel.innerHTML = '<span class="status-dot"></span>' + titleCase(state.status);
      const total = Number(state.total || 0);
      const current = Number(state.current || 0);
      count.textContent = total > 1 ? Math.min(current, total) + ' / ' + total : '';
      const rate = Number(state.rate || 1);
      rateButtons.forEach((button) => button.classList.toggle('is-active', Math.abs(Number(button.dataset.rate) - rate) < 0.01));
      const percent = total > 0 ? Math.max(8, Math.min(100, Math.round((current / total) * 100))) : 8;
      bar.style.width = percent + '%';
      bar.style.background = state.status === 'error' ? '#d66b61' : state.status === 'done' ? '#58c47d' : '#58c4b7';
      if (state.status === 'stopped' || state.status === 'done' || state.status === 'error') {
        stop.textContent = 'Close';
        if (!closeQueued && state.status === 'done') {
          closeQueued = true;
          setTimeout(() => window.close(), 1400);
        }
      }
    }

    async function refresh() {
      try {
        const response = await fetch('/state', { cache: 'no-store' });
        render(await response.json());
      } catch {
        statusLabel.textContent = 'Closed';
      }
    }

    stop.addEventListener('click', async () => {
      if (stop.textContent === 'Close') window.close();
      stop.disabled = true;
      stop.textContent = 'Stopping';
      try { await fetch('/stop', { method: 'POST' }); } catch {}
      stop.disabled = false;
      await refresh();
    });
    rateButtons.forEach((button) => {
      button.addEventListener('click', async () => {
        const rate = Number(button.dataset.rate || 1);
        rateButtons.forEach((item) => item.classList.toggle('is-active', item === button));
        try {
          await fetch('/rate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rate }) });
        } catch {}
        await refresh();
      });
    });
    setInterval(refresh, 250);
    refresh();
  </script>
</body>
</html>`;
}

function openControllerWindow(url: string): void {
  const command = controllerWindowCommand(url, { nativeOverlayExecutable: prepareNativeSpeechOverlay() });
  if (!command) return;
  const child = spawn(command.command, command.args, { detached: true, stdio: 'ignore' });
  child.unref();
}

function listenLocal(server: Server): Promise<string> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Could not start Kokoro Reader controller.'));
        return;
      }
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

function sendHtml(response: ServerResponse): void {
  response.writeHead(200, {
    'Cache-Control': 'no-store',
    'Content-Type': 'text/html; charset=utf-8',
  });
  response.end(speechControllerHtml());
}

function sendJson(response: ServerResponse, value: unknown, status = 200): void {
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(value));
}

function readJson<T>(request: IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))));
    request.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as T);
      } catch (err) {
        reject(err);
      }
    });
    request.on('error', reject);
  });
}

function closeServer(server: Server): void {
  server.close(() => {});
}

function chromeExecutable(): string | undefined {
  return [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    join(homedir(), 'Applications', 'Google Chrome.app', 'Contents', 'MacOS', 'Google Chrome'),
  ].find((path) => existsSync(path));
}
