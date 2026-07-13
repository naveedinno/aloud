import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
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

export function readerSystemHealth(status?: SpeechDaemonStatus, home = homedir()): ReaderSystemHealth {
  const servicesDir = join(home, 'Library', 'Services');
  const launchAgentsDir = join(home, 'Library', 'LaunchAgents');
  const menuBarExecutable = join(home, 'Library', 'Application Support', 'Kokoro Reader', 'menubar', 'KokoroReaderMenuBar');
  const isMac = process.platform === 'darwin';
  const servicesReady = isMac
    && existsSync(join(servicesDir, 'Read Aloud with Kokoro.workflow'))
    && existsSync(join(servicesDir, 'Stop Kokoro Reader.workflow'));
  const menuBarReady = isMac
    && existsSync(join(launchAgentsDir, 'local.kokoro-reader.menubar.plist'))
    && existsSync(menuBarExecutable);
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
      detail: menuBarReady ? 'Menu-bar helper is installed.' : 'Menu-bar helper is not installed yet.',
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
    stdio: 'ignore',
  });
  child.on('error', (error) => {
    repairState = { action, message: error.message, running: false };
  });
  child.on('close', (code) => {
    repairState = {
      action,
      message: code === 0 ? 'Setup finished.' : `Setup failed with status ${code ?? 'unknown'}.`,
      running: false,
    };
  });
  return { message: label, started: true };
}

export function kokoroEnvironmentReady(home = homedir()): boolean {
  const venv = kokoroTtsVenvDir(home);
  if (!existsSync(join(venv, 'bin', 'python'))) return false;
  const libDir = join(venv, 'lib');
  if (!existsSync(libDir)) return false;
  try {
    return readdirSync(libDir).some((entry) => existsSync(join(libDir, entry, 'site-packages', 'kokoro')));
  } catch {
    return false;
  }
}
