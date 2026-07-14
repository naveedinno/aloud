import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { accessSync, constants, existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { kokoroTtsVenvDir } from './kokoro-tts.js';
import type { SpeechDaemonStatus } from './daemon.js';

export type SystemRepairAction = 'accessibility' | 'kokoro' | 'services';

export interface SystemCheck {
  detail: string;
  state: 'needs-action' | 'ready' | 'unknown';
}

export interface ReaderSystemHealth {
  accessibility: SystemCheck;
  daemon: SystemCheck;
  kokoro: SystemCheck;
  menuBar: SystemCheck;
  platform: NodeJS.Platform;
  repair?: {
    action: SystemRepairAction;
    message: string;
    running: boolean;
  };
  services: SystemCheck;
}

let repairState: ReaderSystemHealth['repair'];
const launchAgentState = new Map<string, { checkedAt: number; loaded: boolean }>();
const KOKORO_MODEL_REPOSITORY = 'hexgrad/Kokoro-82M';
const KOKORO_MODEL_REVISION = 'f3ff3571791e39611d31c381e3a41a3af07b4987';
const KOKORO_REQUIRED_MODEL_FILES = [
  'config.json',
  'kokoro-v1_0.pth',
  'voices/af_heart.pt',
  'voices/af_bella.pt',
  'voices/af_nicole.pt',
  'voices/af_sarah.pt',
  'voices/am_adam.pt',
  'voices/am_onyx.pt',
  'voices/bf_emma.pt',
  'voices/bm_daniel.pt',
] as const;
const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

interface KokoroSetupManifest {
  modelRepository?: string;
  modelRevision?: string;
  pythonVersion?: string;
  requiredModelFiles?: unknown;
  requirementsLockSha256?: string;
  schemaVersion?: number;
  status?: string;
}

export interface SystemHealthOptions {
  launchAgentLoaded?: (label: string) => boolean;
}

export function readerSystemHealth(
  status?: SpeechDaemonStatus,
  home = homedir(),
  options: SystemHealthOptions = {},
): ReaderSystemHealth {
  const servicesDir = join(home, 'Library', 'Services');
  const launchAgentsDir = join(home, 'Library', 'LaunchAgents');
  const menuBarExecutable = join(home, 'Library', 'Application Support', 'Kokoro Reader', 'menubar', 'KokoroReaderMenuBar');
  const isMac = process.platform === 'darwin';
  const servicesReady = isMac
    && existsSync(join(servicesDir, 'Read Aloud with Kokoro.workflow'))
    && existsSync(join(servicesDir, 'Stop Kokoro Reader.workflow'));
  const menuBarInstalled = isMac
    && existsSync(join(launchAgentsDir, 'local.kokoro-reader.menubar.plist'))
    && executableExists(menuBarExecutable);
  const isLoaded = options.launchAgentLoaded ?? defaultLaunchAgentLoaded;
  const menuBarReady = menuBarInstalled && isLoaded('local.kokoro-reader.menubar');
  const kokoroReady = kokoroEnvironmentReady(home);
  const accessibilityState = typeof status?.accessibilityTrusted === 'boolean'
    ? status.accessibilityTrusted ? 'ready' : 'needs-action'
    : 'unknown';

  return {
    accessibility: {
      detail: accessibilityState === 'ready'
        ? 'Selection shortcut is allowed.'
        : accessibilityState === 'needs-action'
          ? 'Allow the menu-bar helper in Accessibility.'
          : 'Install and open the menu-bar helper to check permission.',
      state: accessibilityState,
    },
    daemon: {
      detail: status?.ok ? 'Shared reader is available.' : 'Shared reader is unavailable.',
      state: status?.ok ? 'ready' : 'needs-action',
    },
    kokoro: {
      detail: kokoroReady ? 'Local Kokoro environment is installed.' : 'Kokoro still needs local setup.',
      state: kokoroReady ? 'ready' : 'needs-action',
    },
    menuBar: {
      detail: menuBarReady
        ? 'Menu-bar helper is installed and running.'
        : menuBarInstalled
          ? 'Menu-bar helper is installed but not running.'
          : 'Menu-bar helper is not installed yet.',
      state: menuBarReady ? 'ready' : 'needs-action',
    },
    platform: process.platform,
    repair: repairState,
    services: {
      detail: servicesReady ? 'Read Aloud and Stop Services are installed.' : 'macOS Services are not installed yet.',
      state: servicesReady ? 'ready' : 'needs-action',
    },
  };
}

export function runSystemRepair(action: SystemRepairAction, projectRoot: string): { message: string; started: boolean } {
  if (process.platform !== 'darwin') throw new Error('Kokoro Reader setup actions currently support macOS only.');
  if (repairState?.running) return { message: repairState.message, started: false };

  if (action === 'accessibility') {
    const child = spawn('/usr/bin/open', ['x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    repairState = { action, message: 'Accessibility settings opened.', running: false };
    return { message: repairState.message, started: true };
  }

  const script = action === 'kokoro'
    ? join(projectRoot, 'scripts', 'setup-kokoro.sh')
    : join(projectRoot, 'scripts', 'install-macos-service.sh');
  if (!existsSync(script)) throw new Error(`Setup script is missing: ${script}`);

  const label = action === 'kokoro' ? 'Setting up Kokoro…' : 'Installing Services and menu bar…';
  repairState = { action, message: label, running: true };
  const child = spawn('/bin/bash', [script], {
    cwd: projectRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  let spawnError: string | undefined;
  const captureOutput = (chunk: unknown) => {
    output = `${output}${String(chunk)}`.slice(-8_192);
    const detail = lastMeaningfulLine(output);
    if (detail) repairState = { action, message: detail, running: true };
  };
  child.stdout?.on('data', captureOutput);
  child.stderr?.on('data', captureOutput);
  child.on('error', (error) => {
    spawnError = error.message;
    repairState = { action, message: error.message, running: false };
  });
  child.on('close', (code) => {
    const detail = lastMeaningfulLine(output);
    repairState = {
      action,
      message: spawnError
        ? spawnError
        : code === 0
        ? 'Setup finished.'
        : detail || `Setup failed with status ${code ?? 'unknown'}.`,
      running: false,
    };
  });
  return { message: label, started: true };
}

export function kokoroEnvironmentReady(home = homedir()): boolean {
  const appSupport = join(home, 'Library', 'Application Support', 'Kokoro Reader');
  const venv = kokoroTtsVenvDir(home);
  if (!executableExists(join(venv, 'bin', 'python'))) return false;
  const libDir = join(venv, 'lib');
  if (!existsSync(libDir)) return false;
  try {
    if (!readdirSync(libDir).some((entry) => existsSync(join(libDir, entry, 'site-packages', 'kokoro')))) return false;
  } catch {
    return false;
  }

  let manifest: KokoroSetupManifest;
  try {
    manifest = JSON.parse(readFileSync(join(appSupport, 'setup-manifest.json'), 'utf8')) as KokoroSetupManifest;
  } catch {
    return false;
  }
  if (
    manifest.schemaVersion !== 1
    || manifest.status !== 'complete'
    || manifest.pythonVersion !== '3.12'
    || manifest.modelRepository !== KOKORO_MODEL_REPOSITORY
    || manifest.modelRevision !== KOKORO_MODEL_REVISION
    || !sameStringArray(manifest.requiredModelFiles, KOKORO_REQUIRED_MODEL_FILES)
  ) return false;

  try {
    const lock = readFileSync(join(PROJECT_ROOT, 'requirements-kokoro-py312.lock.txt'));
    if (manifest.requirementsLockSha256 !== createHash('sha256').update(lock).digest('hex')) return false;
  } catch {
    return false;
  }

  const modelCache = join(
    appSupport,
    'huggingface',
    'hub',
    'models--hexgrad--Kokoro-82M',
  );
  try {
    if (readFileSync(join(modelCache, 'refs', 'main'), 'utf8').trim() !== KOKORO_MODEL_REVISION) return false;
  } catch {
    return false;
  }
  const snapshot = join(modelCache, 'snapshots', KOKORO_MODEL_REVISION);
  return KOKORO_REQUIRED_MODEL_FILES.every((relativePath) => existsSync(join(snapshot, relativePath)));
}

function sameStringArray(value: unknown, expected: readonly string[]): boolean {
  return Array.isArray(value)
    && value.length === expected.length
    && value.every((entry, index) => entry === expected[index]);
}

function executableExists(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function defaultLaunchAgentLoaded(label: string): boolean {
  if (process.platform !== 'darwin' || typeof process.getuid !== 'function') return false;
  const cached = launchAgentState.get(label);
  if (cached && Date.now() - cached.checkedAt < 15_000) return cached.loaded;
  const result = spawnSync('/bin/launchctl', ['print', `gui/${process.getuid()}/${label}`], {
    stdio: 'ignore',
    timeout: 1_500,
  });
  const loaded = result.status === 0;
  launchAgentState.set(label, { checkedAt: Date.now(), loaded });
  return loaded;
}

function lastMeaningfulLine(value: string): string {
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return (lines.at(-1) ?? '').slice(0, 320);
}
