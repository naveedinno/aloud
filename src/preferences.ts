import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { kokoroReaderSupportDir } from './kokoro-tts.js';
import type { SpeechMode } from './speak.js';

export const GLOBAL_SHORTCUTS = [
  { id: 'option+r', label: 'Option + R' },
  { id: 'option+space', label: 'Option + Space' },
  { id: 'control+option+r', label: 'Control + Option + R' },
  { id: 'command+shift+r', label: 'Command + Shift + R' },
] as const;

export type GlobalShortcut = (typeof GLOBAL_SHORTCUTS)[number]['id'];

export interface ReaderPreferences {
  mode: SpeechMode;
  rate: number;
  shortcut: GlobalShortcut;
  voice: string;
}

export const DEFAULT_READER_PREFERENCES: ReaderPreferences = {
  mode: 'auto',
  rate: 1,
  shortcut: 'option+r',
  voice: 'af_heart',
};

export function readerPreferencesPath(home: string): string {
  return join(kokoroReaderSupportDir(home), 'preferences.json');
}

export function loadReaderPreferences(home: string): Partial<ReaderPreferences> {
  const path = readerPreferencesPath(home);
  if (!existsSync(path)) return {};
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as Partial<ReaderPreferences>;
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

export function saveReaderPreferences(home: string, preferences: ReaderPreferences): void {
  const path = readerPreferencesPath(home);
  mkdirSync(kokoroReaderSupportDir(home), { recursive: true });
  writeFileSync(path, `${JSON.stringify(preferences, null, 2)}\n`, 'utf8');
}

export function normalizeGlobalShortcut(value?: string): GlobalShortcut {
  const normalized = String(value ?? '').toLowerCase().trim().replace(/\s+/g, '');
  return GLOBAL_SHORTCUTS.some((shortcut) => shortcut.id === normalized)
    ? normalized as GlobalShortcut
    : DEFAULT_READER_PREFERENCES.shortcut;
}

export function globalShortcutLabel(value?: string): string {
  const shortcut = normalizeGlobalShortcut(value);
  return GLOBAL_SHORTCUTS.find((option) => option.id === shortcut)?.label ?? 'Option + R';
}
