import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { kokoroReaderSupportDir } from './kokoro-tts.js';

const MENUBAR_SWIFT = String.raw`import AppKit
import ApplicationServices
import Carbon.HIToolbox
import Foundation

typealias ClipboardSnapshot = [[NSPasteboard.PasteboardType: Data]]

private func fourCharCode(_ text: String) -> OSType {
    var result: UInt32 = 0
    for scalar in text.unicodeScalars.prefix(4) {
        result = (result << 8) + UInt32(scalar.value)
    }
    return result
}

private func hotKeyEventHandler(
    nextHandler: EventHandlerCallRef?,
    event: EventRef?,
    userData: UnsafeMutableRawPointer?
) -> OSStatus {
    guard let userData else { return noErr }
    let controller = Unmanaged<MenuBarController>.fromOpaque(userData).takeUnretainedValue()
    controller.handleGlobalHotKey()
    return noErr
}

struct DaemonStatus: Decodable {
    struct State: Decodable {
        let message: String?
        let status: String?
    }
    let ok: Bool?
    let protocolVersion: Int?
    let service: String?
    let mode: String?
    let modeLabel: String?
    let paused: Bool?
    let rate: Double?
    let running: Bool?
    let shortcut: String?
    let shortcutLabel: String?
    let state: State?
    let voice: String?
    let voiceLabel: String?
}

enum MenuBarVisualState {
    case idle
    case generating
    case reading
}

final class MenuBarController: NSObject, NSApplicationDelegate {
    private let baseURL = URL(string: "http://127.0.0.1:17878")!
    private let nodeBin: String
    private let cliPath: String
    private let workingDirectory: String
    private let installerPath: String
    private var hotKeyRef: EventHotKeyRef?
    private var hotKeyHandlerRef: EventHandlerRef?
    private var statusItem: NSStatusItem!
    private var statusMenuItem: NSMenuItem!
    private var stopMenuItem: NSMenuItem!
    private var pauseMenuItem: NSMenuItem!
    private var pollTimer: Timer?
    private var accessibilityTimer: Timer?
    private var pollInFlight = false
    private var readerItems: [NSMenuItem] = []
    private var selectionMenuItem: NSMenuItem!
    private var modeItems: [NSMenuItem] = []
    private var speedItems: [NSMenuItem] = []
    private var currentMode = "auto"
    private var currentModeLabel = "Auto"
    private var currentRate: Double = 1
    private var currentShortcut = "option+r"
    private var currentShortcutLabel = "Option + R"
    private var currentVoice = "af_heart"
    private var currentVoiceLabel = "Heart"
    private var isPaused = false
    private var isRunning = false
    private var visualState: MenuBarVisualState = .idle

    init(nodeBin: String, cliPath: String, workingDirectory: String, installerPath: String) {
        self.nodeBin = nodeBin
        self.cliPath = cliPath
        self.workingDirectory = workingDirectory
        self.installerPath = installerPath
        super.init()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        buildMenu()
        registerReadSelectionHotKey()
        reportAccessibilityTrust()
        pollStatus()
        accessibilityTimer = Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { [weak self] _ in
            self?.reportAccessibilityTrust()
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        pollTimer?.invalidate()
        accessibilityTimer?.invalidate()
    }

    private func buildMenu() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        if let button = statusItem.button {
            button.title = ""
            setMenuBarIcon(state: .idle)
        }

        let menu = NSMenu()
        menu.autoenablesItems = false
        let title = NSMenuItem(title: "Kokoro Reader", action: nil, keyEquivalent: "")
        title.isEnabled = false
        menu.addItem(title)

        statusMenuItem = NSMenuItem(title: "Ready", action: nil, keyEquivalent: "")
        statusMenuItem.isEnabled = false
        menu.addItem(statusMenuItem)
        menu.addItem(.separator())

        stopMenuItem = NSMenuItem(title: "Stop Reading", action: #selector(stopReading), keyEquivalent: "")
        stopMenuItem.target = self
        menu.addItem(stopMenuItem)

        pauseMenuItem = NSMenuItem(title: "Pause Reading", action: #selector(togglePause), keyEquivalent: "")
        pauseMenuItem.target = self
        menu.addItem(pauseMenuItem)

        selectionMenuItem = NSMenuItem(title: "Read Selection (Option + R)", action: #selector(readSelection), keyEquivalent: "")
        selectionMenuItem.target = self
        menu.addItem(selectionMenuItem)

        let clipboardItem = NSMenuItem(title: "Read Clipboard", action: #selector(readClipboard), keyEquivalent: "")
        clipboardItem.target = self
        menu.addItem(clipboardItem)
        menu.addItem(.separator())

        let readerMenu = NSMenu()
        readerMenu.autoenablesItems = false
        for (title, voice) in [
            ("Random", "random"),
            ("Heart", "af_heart"),
            ("Bella", "af_bella"),
            ("Nicole", "af_nicole"),
            ("Sarah", "af_sarah"),
            ("Adam", "am_adam"),
            ("Onyx", "am_onyx"),
            ("Emma", "bf_emma"),
            ("Daniel", "bm_daniel")
        ] {
            let item = NSMenuItem(title: title, action: #selector(setReader(_:)), keyEquivalent: "")
            item.target = self
            item.representedObject = voice
            readerMenu.addItem(item)
            readerItems.append(item)
        }
        let readerRoot = NSMenuItem(title: "Reader", action: nil, keyEquivalent: "")
        readerRoot.submenu = readerMenu
        menu.addItem(readerRoot)

        let modeMenu = NSMenu()
        modeMenu.autoenablesItems = false
        for (title, mode) in [
            ("Auto", "auto"),
            ("Fast Start", "fast-start"),
            ("Smooth Playback", "smooth")
        ] {
            let item = NSMenuItem(title: title, action: #selector(setMode(_:)), keyEquivalent: "")
            item.target = self
            item.representedObject = mode
            modeMenu.addItem(item)
            modeItems.append(item)
        }
        let modeRoot = NSMenuItem(title: "Mode", action: nil, keyEquivalent: "")
        modeRoot.submenu = modeMenu
        menu.addItem(modeRoot)

        let speedMenu = NSMenu()
        speedMenu.autoenablesItems = false
        for (title, rate) in [("Slow 0.8x", 0.8), ("Normal 1x", 1.0), ("Fast 1.25x", 1.25)] {
            let item = NSMenuItem(title: title, action: #selector(setSpeed(_:)), keyEquivalent: "")
            item.target = self
            item.representedObject = rate
            speedMenu.addItem(item)
            speedItems.append(item)
        }
        let speedRoot = NSMenuItem(title: "Speed", action: nil, keyEquivalent: "")
        speedRoot.submenu = speedMenu
        menu.addItem(speedRoot)
        menu.addItem(.separator())

        let openItem = NSMenuItem(title: "Open Reader", action: #selector(openReader), keyEquivalent: "")
        openItem.target = self
        menu.addItem(openItem)

        let installItem = NSMenuItem(title: "Install Services", action: #selector(installServices), keyEquivalent: "")
        installItem.target = self
        menu.addItem(installItem)
        menu.addItem(.separator())

        let quitItem = NSMenuItem(title: "Quit Menu Bar", action: #selector(quit), keyEquivalent: "q")
        quitItem.target = self
        menu.addItem(quitItem)

        statusItem.menu = menu
        render()
    }

    private func render() {
        statusMenuItem.title = isPaused ? "Paused with \(currentVoiceLabel)" : (isRunning ? "Reading with \(currentVoiceLabel)" : "Ready with \(currentVoiceLabel)")
        stopMenuItem.isEnabled = isRunning
        pauseMenuItem.isEnabled = isRunning
        pauseMenuItem.title = isPaused ? "Resume Reading" : "Pause Reading"
        selectionMenuItem.title = "Read Selection (\(currentShortcutLabel))"
        setMenuBarIcon(state: visualState)
        for item in readerItems {
            item.state = (item.representedObject as? String) == currentVoice ? .on : .off
        }
        for item in modeItems {
            item.state = (item.representedObject as? String) == currentMode ? .on : .off
        }
        let selected = Int(round(currentRate * 100))
        for item in speedItems {
            let rate = item.representedObject as? Double ?? 1
            item.state = abs(Int(round(rate * 100)) - selected) <= 3 ? .on : .off
        }
    }

    private func pollStatus() {
        pollTimer?.invalidate()
        pollTimer = nil
        guard !pollInFlight else { return }
        pollInFlight = true
        request(path: "status", method: "GET") { [weak self] data in
            guard let self else { return }
            guard let data,
                  let status = try? JSONDecoder().decode(DaemonStatus.self, from: data),
                  status.ok == true,
                  status.protocolVersion == 1,
                  status.service == "kokoro-reader-speech-daemon" else {
                DispatchQueue.main.async {
                    self.pollInFlight = false
                    self.isRunning = false
                    self.isPaused = false
                    self.visualState = .idle
                    self.statusMenuItem.title = "Daemon unavailable"
                    self.stopMenuItem.isEnabled = false
                    self.pauseMenuItem.isEnabled = false
                    self.setMenuBarIcon(state: .idle)
                    self.scheduleStatusPoll()
                }
                return
            }
            DispatchQueue.main.async {
                self.pollInFlight = false
                self.currentRate = status.rate ?? self.currentRate
                let nextShortcut = status.shortcut ?? self.currentShortcut
                if nextShortcut != self.currentShortcut {
                    self.currentShortcut = nextShortcut
                    self.currentShortcutLabel = status.shortcutLabel ?? self.currentShortcutLabel
                    self.registerReadSelectionHotKey()
                } else {
                    self.currentShortcutLabel = status.shortcutLabel ?? self.currentShortcutLabel
                }
                self.currentMode = status.mode ?? self.currentMode
                self.currentModeLabel = status.modeLabel ?? self.currentModeLabel
                self.currentVoice = status.voice ?? self.currentVoice
                self.currentVoiceLabel = status.voiceLabel ?? self.currentVoiceLabel
                self.isPaused = status.paused ?? false
                self.isRunning = status.running ?? false
                self.visualState = self.iconState(running: self.isRunning, daemonStatus: status.state?.status)
                if let message = status.state?.message, !message.isEmpty, status.voiceLabel == nil {
                    self.statusMenuItem.title = message
                }
                self.render()
                self.scheduleStatusPoll()
            }
        }
    }

    private func scheduleStatusPoll() {
        pollTimer?.invalidate()
        let interval = isRunning ? 0.75 : 5.0
        pollTimer = Timer.scheduledTimer(withTimeInterval: interval, repeats: false) { [weak self] _ in
            self?.pollStatus()
        }
    }

    func handleGlobalHotKey() {
        readSelection()
    }

    private func registerReadSelectionHotKey() {
        if hotKeyHandlerRef == nil {
            var eventType = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
            InstallEventHandler(
                GetApplicationEventTarget(),
                hotKeyEventHandler,
                1,
                &eventType,
                Unmanaged.passUnretained(self).toOpaque(),
                &hotKeyHandlerRef
            )
        }
        if let hotKeyRef {
            UnregisterEventHotKey(hotKeyRef)
            self.hotKeyRef = nil
        }
        let definition = shortcutDefinition(currentShortcut)
        let hotKeyID = EventHotKeyID(signature: fourCharCode("KOKR"), id: 1)
        RegisterEventHotKey(
            definition.keyCode,
            definition.modifiers,
            hotKeyID,
            GetApplicationEventTarget(),
            0,
            &hotKeyRef
        )
    }

    private func shortcutDefinition(_ shortcut: String) -> (keyCode: UInt32, modifiers: UInt32) {
        switch shortcut {
        case "option+space":
            return (UInt32(kVK_Space), UInt32(optionKey))
        case "control+option+r":
            return (UInt32(kVK_ANSI_R), UInt32(controlKey | optionKey))
        case "command+shift+r":
            return (UInt32(kVK_ANSI_R), UInt32(cmdKey | shiftKey))
        default:
            return (UInt32(kVK_ANSI_R), UInt32(optionKey))
        }
    }

    private func reportAccessibilityTrust() {
        let trusted = AXIsProcessTrusted()
        let payload = "{\"trusted\":\(trusted ? "true" : "false")}".data(using: .utf8)
        request(path: "accessibility", method: "POST", body: payload) { _ in }
    }

    @objc private func stopReading() {
        request(path: "stop", method: "POST") { [weak self] _ in
            DispatchQueue.main.async {
                self?.isRunning = false
                self?.isPaused = false
                self?.visualState = .idle
                self?.render()
            }
        }
    }

    @objc private func togglePause() {
        request(path: isPaused ? "resume" : "pause", method: "POST") { [weak self] _ in
            DispatchQueue.main.async {
                guard let self else { return }
                self.isPaused.toggle()
                self.render()
                self.pollStatus()
            }
        }
    }

    @objc private func readSelection() {
        guard accessibilityTrusted() else {
            notify("Allow Kokoro Reader in Accessibility, then press Option+R again.")
            return
        }
        let snapshot = captureClipboard()
        postCopyShortcut()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.18) { [weak self] in
            guard let self else { return }
            let text = NSPasteboard.general.string(forType: .string)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            self.restoreClipboard(snapshot)
            if text.isEmpty {
                self.notify("No selected text to read.")
                return
            }
            self.beginReading(text: text)
        }
    }

    @objc private func readClipboard() {
        let text = NSPasteboard.general.string(forType: .string)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if text.isEmpty {
            notify("Clipboard has no readable text.")
            return
        }
        beginReading(text: text)
    }

    private func beginReading(text: String) {
        guard let payload = speakPayload(text: text) else {
            notify("Could not read selected text.")
            return
        }
        isRunning = true
        isPaused = false
        visualState = .generating
        render()
        request(path: "speak", method: "POST", body: payload) { [weak self] data in
            DispatchQueue.main.async {
                guard let self else { return }
                if data == nil {
                    self.isRunning = false
                    self.visualState = .idle
                    self.render()
                    self.notify("Could not reach Kokoro Reader.")
                } else {
                    self.pollStatus()
                }
            }
        }
    }

    private func accessibilityTrusted() -> Bool {
        let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
        return AXIsProcessTrustedWithOptions(options)
    }

    private func captureClipboard() -> ClipboardSnapshot {
        NSPasteboard.general.pasteboardItems?.map { item in
            var contents: [NSPasteboard.PasteboardType: Data] = [:]
            for type in item.types {
                if let data = item.data(forType: type) {
                    contents[type] = data
                }
            }
            return contents
        } ?? []
    }

    private func restoreClipboard(_ snapshot: ClipboardSnapshot) {
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        let items = snapshot.map { contents -> NSPasteboardItem in
            let item = NSPasteboardItem()
            for (type, data) in contents {
                item.setData(data, forType: type)
            }
            return item
        }
        if !items.isEmpty {
            pasteboard.writeObjects(items)
        }
    }

    private func postCopyShortcut() {
        let source = CGEventSource(stateID: .combinedSessionState)
        let keyDown = CGEvent(keyboardEventSource: source, virtualKey: CGKeyCode(kVK_ANSI_C), keyDown: true)
        let keyUp = CGEvent(keyboardEventSource: source, virtualKey: CGKeyCode(kVK_ANSI_C), keyDown: false)
        keyDown?.flags = .maskCommand
        keyUp?.flags = .maskCommand
        keyDown?.post(tap: .cghidEventTap)
        keyUp?.post(tap: .cghidEventTap)
    }

    @objc private func setReader(_ sender: NSMenuItem) {
        guard let voice = sender.representedObject as? String else { return }
        currentVoice = voice
        currentVoiceLabel = sender.title
        render()
        let payload = "{\"voice\":\"\(voice)\"}".data(using: .utf8)
        request(path: "voice", method: "POST", body: payload) { [weak self] _ in
            self?.pollStatus()
        }
    }

    @objc private func setMode(_ sender: NSMenuItem) {
        guard let mode = sender.representedObject as? String else { return }
        currentMode = mode
        currentModeLabel = sender.title
        render()
        let payload = "{\"mode\":\"\(mode)\"}".data(using: .utf8)
        request(path: "mode", method: "POST", body: payload) { [weak self] _ in
            self?.pollStatus()
        }
    }

    @objc private func setSpeed(_ sender: NSMenuItem) {
        guard let rate = sender.representedObject as? Double else { return }
        currentRate = rate
        render()
        let payload = "{\"rate\":\(rate)}".data(using: .utf8)
        request(path: "rate", method: "POST", body: payload) { [weak self] _ in
            self?.pollStatus()
        }
    }

    @objc private func openReader() {
        runProcess(executable: nodeBin, arguments: [cliPath])
    }

    @objc private func installServices() {
        runProcess(executable: "/bin/bash", arguments: [installerPath])
        notify("Installing Services...")
    }

    @objc private func quit() {
        NSApp.terminate(nil)
    }

    private func request(path: String, method: String, body: Data? = nil, completion: @escaping (Data?) -> Void) {
        var request = URLRequest(url: baseURL.appendingPathComponent(path))
        request.httpMethod = method
        request.timeoutInterval = 4
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if method == "POST" {
            request.httpBody = body ?? Data("{}".utf8)
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        URLSession.shared.dataTask(with: request) { data, response, error in
            guard error == nil,
                  let response = response as? HTTPURLResponse,
                  (200..<300).contains(response.statusCode) else {
                completion(nil)
                return
            }
            completion(data)
        }.resume()
    }

    private func speakPayload(text: String) -> Data? {
        let payload: [String: Any] = [
            "text": text,
            "mode": currentMode,
            "rate": currentRate,
            "voice": currentVoice
        ]
        return try? JSONSerialization.data(withJSONObject: payload)
    }

    private func notify(_ message: String) {
        let notification = NSUserNotification()
        notification.title = "Kokoro Reader"
        notification.informativeText = message
        NSUserNotificationCenter.default.deliver(notification)
    }

    private func iconState(running: Bool, daemonStatus: String?) -> MenuBarVisualState {
        guard running else { return .idle }
        return daemonStatus == "reading" ? .reading : .generating
    }

    private func setMenuBarIcon(state: MenuBarVisualState) {
        guard let button = statusItem.button else { return }
        button.image = menuBarIcon(state: state)
        button.title = ""
    }

    private func menuBarIcon(state: MenuBarVisualState) -> NSImage {
        let image = NSImage(size: NSSize(width: 18, height: 18))
        image.lockFocus()
        let strokeColor: NSColor
        switch state {
        case .idle:
            strokeColor = .black
        case .generating:
            strokeColor = NSColor(calibratedRed: 0.95, green: 0.68, blue: 0.16, alpha: 1.0)
        case .reading:
            strokeColor = NSColor(calibratedRed: 0.20, green: 0.78, blue: 0.46, alpha: 1.0)
        }
        strokeColor.setStroke()

        let mark = NSBezierPath()
        mark.lineWidth = 1.9
        mark.lineCapStyle = .round
        mark.lineJoinStyle = .round
        mark.move(to: NSPoint(x: 4.8, y: 4.2))
        mark.line(to: NSPoint(x: 4.8, y: 13.8))
        mark.move(to: NSPoint(x: 5.2, y: 9.0))
        mark.line(to: NSPoint(x: 9.2, y: 13.2))
        mark.move(to: NSPoint(x: 5.2, y: 9.0))
        mark.line(to: NSPoint(x: 9.2, y: 4.8))
        mark.stroke()

        let innerWave = NSBezierPath()
        innerWave.lineWidth = 1.45
        innerWave.lineCapStyle = .round
        innerWave.appendArc(withCenter: NSPoint(x: 9.8, y: 9.0), radius: 3.2, startAngle: -42, endAngle: 42)
        innerWave.stroke()

        if state != .idle {
            let outerWave = NSBezierPath()
            outerWave.lineWidth = 1.25
            outerWave.lineCapStyle = .round
            outerWave.appendArc(withCenter: NSPoint(x: 9.8, y: 9.0), radius: 5.4, startAngle: -38, endAngle: 38)
            outerWave.stroke()
        }

        image.unlockFocus()
        image.isTemplate = state == .idle
        image.accessibilityDescription = "Kokoro Reader"
        return image
    }

    private func runProcess(executable: String, arguments: [String]) {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: executable)
        process.arguments = arguments
        process.currentDirectoryURL = URL(fileURLWithPath: workingDirectory)
        try? process.run()
    }
}

let args = CommandLine.arguments
let nodeBin = args.count > 1 ? args[1] : "/usr/local/bin/node"
let cliPath = args.count > 2 ? args[2] : ""
let workingDirectory = args.count > 3 ? args[3] : FileManager.default.currentDirectoryPath
let installerPath = args.count > 4 ? args[4] : ""

let app = NSApplication.shared
let delegate = MenuBarController(
    nodeBin: nodeBin,
    cliPath: cliPath,
    workingDirectory: workingDirectory,
    installerPath: installerPath
)
app.delegate = delegate
app.run()
`;

export function prepareNativeMenuBar(home = homedir()): string | undefined {
  if (process.platform !== 'darwin') return undefined;
  const paths = nativeMenuBarPaths(home);
  try {
    mkdirSync(paths.dir, { recursive: true });
    const oldSource = existsSync(paths.source) ? readFileSync(paths.source, 'utf8') : '';
    if (oldSource !== MENUBAR_SWIFT) writeFileSync(paths.source, MENUBAR_SWIFT, 'utf8');
    if (!existsSync(paths.executable) || oldSource !== MENUBAR_SWIFT) {
      const result = spawnSync('/usr/bin/swiftc', [paths.source, '-o', paths.executable], { encoding: 'utf8' });
      if (result.status !== 0) return undefined;
    }
    return paths.executable;
  } catch {
    return undefined;
  }
}

export function startNativeMenuBar(opts: { cliPath?: string; installerPath?: string; nodeBin?: string; workdir?: string } = {}): string | undefined {
  const executable = prepareNativeMenuBar();
  if (!executable) return undefined;
  const nodeBin = opts.nodeBin ?? process.execPath;
  const cliPath = opts.cliPath ?? process.argv[1];
  const workdir = opts.workdir ?? process.cwd();
  const installerPath = opts.installerPath ?? join(workdir, 'scripts', 'install-macos-service.sh');
  const child = spawn(executable, [nodeBin, cliPath, workdir, installerPath], { detached: true, stdio: 'ignore' });
  child.unref();
  return executable;
}

export function nativeMenuBarPaths(home = homedir()): { dir: string; executable: string; source: string } {
  const dir = join(kokoroReaderSupportDir(home), 'menubar');
  return {
    dir,
    executable: join(dir, 'KokoroReaderMenuBar'),
    source: join(dir, 'KokoroReaderMenuBar.swift'),
  };
}

export function nativeMenuBarSource(): string {
  return MENUBAR_SWIFT;
}
