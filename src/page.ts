import { kokoroVoiceOptions } from './kokoro-tts.js';
import { pocketVoiceOptions } from './pocket-tts.js';
import { GLOBAL_SHORTCUTS } from './preferences.js';

// Keep this below the server's one-megabyte request ceiling even when the
// document contains multi-byte Unicode. The server imports this value too so
// the browser and API can enforce one user-facing limit.
export const MAX_READER_TEXT_CHARACTERS = 240_000;
const MAX_READER_FILE_BYTES = 1_000_000;

function esc(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderPage(): string {
  const kokoroVoices = kokoroVoiceOptions();
  const pocketVoices = pocketVoiceOptions();
  const voiceOptions = [
    '<optgroup label="Kokoro voices" data-engine-options="kokoro">',
    '<option value="random" data-description="Choose a different Kokoro voice for every reading.">Random voice</option>',
    ...kokoroVoices.map((voice) => `<option value="${esc(voice.id)}" data-description="${esc(voice.description)}">${esc(voice.label)}</option>`),
    '</optgroup>',
    '<optgroup label="Pocket TTS voices" data-engine-options="pocket" hidden disabled>',
    '<option value="random" data-description="Choose a different Pocket TTS voice for every reading.">Random voice</option>',
    ...pocketVoices.map((voice) => `<option value="${esc(voice.id)}" data-description="${esc(voice.description)}">${esc(voice.label)}</option>`),
    '</optgroup>',
  ].join('');
  const shortcutOptions = GLOBAL_SHORTCUTS
    .map((shortcut) => `<option value="${esc(shortcut.id)}">${esc(shortcut.label)}</option>`)
    .join('');

  return String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Aloud</title>
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='15' fill='%23131d1b'/%3E%3Cg fill='none' stroke='%237dd3c7' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M10 49 25 15q3-7 6 0l14 34M17 35h22' stroke-width='5'/%3E%3Cpath d='M44 24q9 8 0 16M50 18q15 14 0 28' stroke-width='3.5'/%3E%3C/g%3E%3C/svg%3E">
  <style>
    @font-face {
      font-family: "Kokoro Manrope";
      src: url("/assets/fonts/Manrope-Variable.ttf") format("truetype");
      font-style: normal;
      font-weight: 200 800;
      font-display: swap;
    }
    @font-face {
      font-family: "Kokoro Atkinson";
      src: url("/assets/fonts/AtkinsonHyperlegibleNext-Variable.ttf") format("truetype");
      font-style: normal;
      font-weight: 200 800;
      font-display: swap;
    }
    :root {
      color-scheme: dark;
      --bg: #0e1012;
      --panel: #171a1e;
      --panel-2: #1d2126;
      --panel-3: #23282f;
      --line: #30363f;
      --line-strong: #46505c;
      --text: #f5f2ec;
      --muted: #a9afb9;
      --quiet: #7f8792;
      --soft: #7dd3c7;
      --soft-strong: #9ae5da;
      --soft-2: rgba(125, 211, 199, 0.14);
      --warning: #e9c98d;
      --danger: #ffaaaa;
      --radius: 12px;
      --shadow: 0 18px 54px rgba(0, 0, 0, 0.24);
    }
    * { box-sizing: border-box; }
    html { background: var(--bg); }
    body {
      margin: 0;
      min-height: 100vh;
      background: var(--bg);
      color: var(--text);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    button, select, textarea, input { font: inherit; }
    button, select { -webkit-tap-highlight-color: transparent; }
    button:focus-visible, select:focus-visible, textarea:focus-visible, input:focus-visible, summary:focus-visible {
      outline: 3px solid var(--soft-2);
      outline-offset: 2px;
      border-color: var(--soft) !important;
    }
    button:disabled { cursor: not-allowed; opacity: 0.42; }
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }
    main {
      width: min(1080px, calc(100vw - 36px));
      margin: 0 auto;
      padding: 30px 0 52px;
    }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 18px;
      margin-bottom: 18px;
    }
    h1 {
      margin: 0 0 5px;
      font-size: clamp(25px, 3vw, 32px);
      line-height: 1.05;
      letter-spacing: -0.035em;
    }
    .sub {
      margin: 0;
      color: var(--muted);
      font-size: 14px;
      line-height: 1.5;
    }
    .connection {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      flex: 0 0 auto;
      border: 1px solid var(--line);
      border-radius: 999px;
      background: var(--panel);
      color: var(--muted);
      padding: 8px 11px;
      font-size: 12px;
      font-weight: 700;
    }
    .connection-dot, .health-dot {
      width: 8px;
      height: 8px;
      flex: 0 0 auto;
      border-radius: 999px;
      background: var(--quiet);
    }
    .connection.is-ready .connection-dot, .health-item.is-ready .health-dot { background: var(--soft); }
    .connection.is-connecting .connection-dot { background: var(--warning); }
    .connection.is-busy .connection-dot { background: var(--warning); box-shadow: 0 0 0 4px rgba(233, 201, 141, 0.1); }
    .connection.is-error .connection-dot, .health-item.needs-action .health-dot { background: var(--danger); }
    .connection-retry {
      min-height: 26px;
      border: 1px solid var(--line-strong);
      border-radius: 999px;
      background: var(--panel-2);
      color: var(--text);
      padding: 0 8px;
      cursor: pointer;
      font-size: 11px;
      font-weight: 800;
    }
    .reader-card, details {
      border: 1px solid var(--line);
      border-radius: var(--radius);
      background: var(--panel);
      box-shadow: var(--shadow);
    }
    .reader-card { overflow: hidden; }
    .config-bar {
      display: grid;
      grid-template-columns: minmax(210px, 1.25fr) minmax(170px, 0.85fr) auto;
      gap: 12px;
      align-items: end;
      padding: 16px;
      border-bottom: 1px solid var(--line);
    }
    .field { min-width: 0; }
    .field-label {
      display: block;
      margin: 0 0 7px;
      color: var(--muted);
      font-size: 11px;
      line-height: 1;
      font-weight: 800;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .select-wrap { display: flex; gap: 8px; }
    select, .secondary-button, .utility-button, .icon-button, .speed-button {
      min-height: 42px;
      border: 1px solid var(--line);
      border-radius: 9px;
      background: var(--panel-2);
      color: var(--text);
    }
    select {
      width: 100%;
      padding: 0 34px 0 11px;
      cursor: pointer;
    }
    .secondary-button, .utility-button, .icon-button, .speed-button {
      cursor: pointer;
      font-weight: 750;
    }
    .secondary-button { padding: 0 13px; white-space: nowrap; }
    .field-note {
      min-height: 17px;
      margin: 6px 0 0;
      color: var(--quiet);
      font-size: 11px;
      line-height: 1.4;
    }
    .speed-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 7px; }
    .speed-button { min-width: 58px; padding: 0 10px; font-size: 12px; }
    .speed-button[aria-pressed="true"] {
      border-color: var(--soft);
      background: var(--soft-2);
      color: var(--soft-strong);
    }
    .transport {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto;
      gap: 14px;
      align-items: center;
      padding: 14px 16px;
      border-bottom: 1px solid var(--line);
      background: #14171a;
    }
    .transport-actions, .chunk-actions, .editor-actions { display: flex; align-items: center; gap: 8px; }
    .primary-button {
      min-width: 112px;
      min-height: 44px;
      border: 1px solid var(--soft);
      border-radius: 9px;
      background: var(--soft);
      color: #071311;
      padding: 0 18px;
      cursor: pointer;
      font-weight: 850;
    }
    .stop-button {
      min-width: 68px;
      min-height: 44px;
      border: 1px solid var(--line);
      border-radius: 9px;
      background: var(--panel-2);
      color: var(--muted);
      padding: 0 13px;
      cursor: pointer;
      font-weight: 750;
    }
    .transport-status { min-width: 0; }
    .status-line {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 7px;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.3;
    }
    .status-message {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .status-message.is-error { color: var(--danger); }
    .progress-track {
      width: 100%;
      height: 4px;
      overflow: hidden;
      border-radius: 999px;
      background: var(--panel-3);
    }
    .progress-bar {
      width: 0;
      height: 100%;
      border-radius: inherit;
      background: var(--soft);
      transition: width 180ms ease;
    }
    .icon-button {
      width: 42px;
      padding: 0;
      color: var(--muted);
      font-size: 17px;
    }
    .icon-button:hover:not(:disabled), .secondary-button:hover:not(:disabled), .utility-button:hover:not(:disabled), .speed-button:hover:not(:disabled) {
      border-color: var(--line-strong);
      color: var(--text);
    }
    .editor-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 13px 16px 10px;
    }
    .editor-meta { color: var(--quiet); font-size: 12px; line-height: 1.4; }
    .utility-button {
      min-height: 34px;
      padding: 0 10px;
      color: var(--muted);
      font-size: 12px;
    }
    textarea {
      display: block;
      width: calc(100% - 32px);
      min-height: 460px;
      margin: 0 16px 16px;
      resize: vertical;
      border: 1px solid var(--line);
      border-radius: 10px;
      background: #121519;
      color: var(--text);
      padding: clamp(17px, 3vw, 28px);
      font: 430 18px/1.72 "Kokoro Atkinson", ui-sans-serif, system-ui, sans-serif;
      letter-spacing: 0.002em;
    }
    textarea::placeholder { color: #6e7680; }
    .secondary-grid {
      display: grid;
      grid-template-columns: 1.2fr 0.8fr;
      gap: 14px;
      margin-top: 14px;
    }
    details { box-shadow: none; }
    summary {
      min-height: 54px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 0 15px;
      cursor: pointer;
      list-style: none;
      font-size: 13px;
      font-weight: 800;
    }
    summary::-webkit-details-marker { display: none; }
    .summary-copy { display: flex; align-items: center; gap: 9px; }
    .summary-badge {
      border-radius: 999px;
      background: var(--panel-2);
      color: var(--muted);
      padding: 5px 8px;
      font-size: 10px;
      font-weight: 800;
    }
    details[open] summary { border-bottom: 1px solid var(--line); }
    .details-body { padding: 14px; }
    .health-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .health-item {
      min-height: 76px;
      display: grid;
      grid-template-columns: auto 1fr auto;
      gap: 9px;
      align-items: start;
      border: 1px solid var(--line);
      border-radius: 9px;
      background: var(--panel-2);
      padding: 11px;
    }
    .health-dot { margin-top: 5px; }
    .health-name { display: block; margin-bottom: 3px; font-size: 12px; font-weight: 800; }
    .health-detail { display: block; color: var(--quiet); font-size: 11px; line-height: 1.4; }
    .repair-button {
      min-height: 30px;
      border: 1px solid var(--line-strong);
      border-radius: 7px;
      background: var(--panel-3);
      color: var(--text);
      padding: 0 8px;
      cursor: pointer;
      font-size: 11px;
      font-weight: 750;
      white-space: nowrap;
    }
    .shortcut-row, .privacy-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-top: 10px;
      border-top: 1px solid var(--line);
      padding-top: 12px;
    }
    .shortcut-row select { width: min(210px, 48%); min-height: 38px; }
    .setting-name { display: block; margin-bottom: 3px; font-size: 12px; font-weight: 800; }
    .setting-detail { display: block; color: var(--quiet); font-size: 11px; line-height: 1.4; }
    .privacy-toggle { display: inline-flex; align-items: center; gap: 8px; color: var(--muted); font-size: 12px; }
    .privacy-toggle input { width: 17px; height: 17px; accent-color: var(--soft); }
    .recent-list { display: grid; gap: 7px; margin-top: 12px; }
    .recent-empty { margin: 0; color: var(--quiet); font-size: 12px; line-height: 1.5; }
    .recent-item {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 8px;
      align-items: center;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel-2);
      padding: 9px;
    }
    .recent-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; font-weight: 750; }
    .recent-meta { margin-top: 3px; color: var(--quiet); font-size: 10px; }
    .history-footer { display: flex; justify-content: flex-end; margin-top: 10px; }
    @media (max-width: 820px) {
      main { width: min(100vw - 24px, 680px); padding: 20px 0 34px; }
      header { align-items: flex-start; }
      .config-bar { grid-template-columns: 1fr 1fr; }
      .speed-field { grid-column: 1 / -1; }
      .transport { grid-template-columns: 1fr auto; }
      .transport-status { grid-column: 1 / -1; grid-row: 2; }
      .secondary-grid { grid-template-columns: 1fr; }
      textarea { min-height: 390px; }
    }
    @media (max-width: 520px) {
      main { width: calc(100vw - 18px); padding-top: 14px; }
      header { margin-bottom: 13px; }
      .connection { padding: 7px 9px; }
      .connection [data-connection-label] { display: none; }
      .config-bar { grid-template-columns: 1fr; padding: 13px; }
      .speed-field { grid-column: auto; }
      .transport { position: sticky; top: 0; z-index: 3; grid-template-columns: 1fr; gap: 10px; padding: 12px 13px; }
      .transport-actions { display: grid; grid-template-columns: 1fr auto; }
      .chunk-actions { justify-content: space-between; }
      .transport-status { grid-column: auto; grid-row: auto; }
      .editor-head { align-items: flex-start; padding: 12px 13px 9px; }
      .editor-actions { gap: 6px; }
      textarea { width: calc(100% - 26px); min-height: 330px; margin: 0 13px 13px; padding: 17px; font-size: 17px; }
      .health-grid { grid-template-columns: 1fr; }
      .shortcut-row, .privacy-row { align-items: flex-start; flex-direction: column; }
      .shortcut-row select { width: 100%; }
    }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { animation: none !important; scroll-behavior: auto !important; transition: none !important; }
    }

    /* Listening desk */
    :root {
      --canvas: #0d0f0f;
      --surface: #141717;
      --raised: #191d1d;
      --edge: #2a3030;
      --edge-strong: #3a4241;
      --ink: #f2efe8;
      --muted: #929b99;
      --mint: #85d7c9;
      --mint-bright: #a1e8dd;
      --amber: #e7c483;
      --ease-ui: cubic-bezier(0.22, 1, 0.36, 1);
    }
    html { background: var(--canvas); }
    body {
      min-height: 100vh;
      color: var(--ink);
      background: var(--canvas);
      font-family: "Kokoro Manrope", ui-sans-serif, system-ui, sans-serif;
    }
    .app-shell {
      width: min(1480px, calc(100% - 40px));
      margin: 0 auto;
      padding: 24px 0 30px;
    }
    .app-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 24px;
      margin: 0 0 18px;
      padding: 0 2px;
    }
    .brand { display: flex; align-items: center; gap: 13px; min-width: 0; }
    .brand-mark {
      display: grid;
      width: 38px;
      height: 38px;
      place-items: center;
      flex: 0 0 auto;
      border: 1px solid rgba(125, 211, 199, 0.22);
      border-radius: 11px;
      color: var(--mint);
      background: linear-gradient(145deg, #1b2926, #101715);
      box-shadow: inset 0 1px rgba(255, 255, 255, 0.04), 0 7px 20px rgba(0, 0, 0, 0.2);
    }
    .brand-mark svg { width: 27px; height: 27px; overflow: visible; }
    h1 { margin: 0; color: var(--ink); font-size: 19px; font-weight: 700; letter-spacing: -0.025em; }
    .sub { margin: 2px 0 0; color: var(--muted); font-size: 13px; line-height: 1.4; }
    .connection {
      gap: 8px;
      border-color: var(--edge);
      border-radius: 999px;
      padding: 8px 12px;
      color: #b8c0be;
      background: var(--surface);
      font-size: 12px;
      font-weight: 650;
    }
    .connection-dot { width: 7px; height: 7px; background: var(--muted); box-shadow: none; }
    .connection.is-connecting .connection-dot { background: var(--amber); }
    .connection-retry {
      min-height: 24px;
      border-color: #52605e;
      color: #e2e8e5;
      background: #202625;
      padding: 0 8px;
      font-size: 10px;
    }

    .workspace {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 316px;
      gap: 16px;
      align-items: start;
    }
    .document-panel {
      min-width: 0;
      overflow: hidden;
      border: 1px solid var(--edge);
      border-radius: 16px;
      background: #111414;
      transition: border-color 220ms var(--ease-ui), box-shadow 220ms var(--ease-ui);
    }
    .document-toolbar {
      display: flex;
      min-height: 58px;
      align-items: center;
      justify-content: space-between;
      gap: 20px;
      padding: 0 18px;
      border-bottom: 1px solid var(--edge);
      background: var(--surface);
    }
    .document-title { display: flex; align-items: baseline; gap: 12px; min-width: 0; }
    .document-title h2 { margin: 0; color: var(--ink); font-size: 13px; font-weight: 750; letter-spacing: 0.06em; text-transform: uppercase; }
    .editor-meta { overflow: hidden; color: var(--muted); font-size: 12px; white-space: nowrap; text-overflow: ellipsis; }
    .editor-actions { display: flex; gap: 6px; }
    .document-body { position: relative; overflow: hidden; }
    textarea {
      display: block;
      width: 100%;
      min-height: calc(100vh - 224px);
      margin: 0;
      border: 0;
      border-radius: 0;
      padding: clamp(30px, 4vw, 64px) clamp(28px, 6vw, 86px) 90px;
      resize: vertical;
      color: #eeeae1;
      background: #111414;
      box-shadow: none;
      font: 430 clamp(19px, 1.45vw, 23px)/1.78 "Kokoro Atkinson", ui-sans-serif, system-ui, sans-serif;
      letter-spacing: 0.003em;
      transition: opacity 180ms var(--ease-ui), box-shadow 180ms var(--ease-ui);
    }
    textarea::placeholder { color: #818b88; }
    textarea:focus { outline: 0; box-shadow: inset 3px 0 0 var(--mint); }
    textarea[hidden] { display: none; }
    .reading-view {
      display: block;
      width: 100%;
      height: calc(100vh - 224px);
      min-height: 460px;
      overflow: auto;
      padding: clamp(30px, 4vw, 64px) clamp(28px, 6vw, 86px) 90px;
      color: #909a97;
      background: #111414;
      font: 430 clamp(19px, 1.45vw, 23px)/1.78 "Kokoro Atkinson", ui-sans-serif, system-ui, sans-serif;
      letter-spacing: 0.003em;
      overflow-wrap: anywhere;
      scrollbar-color: #39413f transparent;
      white-space: pre-wrap;
      animation: reading-surface-in 220ms var(--ease-ui) both;
    }
    .reading-view[hidden] { display: none; }
    .active-chunk-segment {
      margin: 0 -0.22em;
      border-radius: 5px;
      padding: 0.08em 0.22em 0.12em;
      color: #f3f5f1;
      background: #203a35;
      box-decoration-break: clone;
      -webkit-box-decoration-break: clone;
      box-shadow: -3px 0 0 var(--mint);
      animation: chunk-focus-in 360ms var(--ease-ui) both;
    }
    .reading-view.is-paused .active-chunk-segment {
      color: #e2e6e2;
      background: #263532;
      box-shadow: -3px 0 0 #6d928b;
    }
    .document-panel.is-reading { border-color: #38514d; box-shadow: 0 16px 46px rgba(0, 0, 0, 0.22); }
    .document-panel.is-dragging { border-color: var(--mint); box-shadow: 0 0 0 3px rgba(133, 215, 201, 0.11), 0 16px 46px rgba(0, 0, 0, 0.22); }
    .drop-prompt {
      position: absolute;
      z-index: 2;
      inset: 12px;
      display: grid;
      place-content: center;
      gap: 5px;
      border: 1px dashed #5e9e94;
      border-radius: 11px;
      color: var(--ink);
      background: rgba(20, 35, 32, 0.96);
      text-align: center;
      pointer-events: none;
      opacity: 0;
      transform: scale(0.99);
      transition: opacity 160ms var(--ease-ui), transform 160ms var(--ease-ui);
    }
    .drop-prompt strong { font-size: 14px; }
    .drop-prompt span { color: var(--muted); font-size: 11px; }
    .document-panel.is-dragging .drop-prompt { opacity: 1; transform: scale(1); }

    .control-rail {
      position: sticky;
      top: 18px;
      display: grid;
      gap: 10px;
    }
    .control-card, details {
      overflow: hidden;
      border: 1px solid var(--edge);
      border-radius: 14px;
      background: var(--surface);
      box-shadow: none;
      transition: border-color 220ms var(--ease-ui), background-color 220ms var(--ease-ui);
    }
    .control-card { padding: 18px; }
    .control-heading { margin-bottom: 18px; }
    .eyebrow { display: block; margin-bottom: 4px; color: var(--mint); font-size: 10px; font-weight: 800; letter-spacing: 0.16em; text-transform: uppercase; }
    .control-heading h2 { margin: 0; color: var(--ink); font-size: 17px; font-weight: 700; letter-spacing: -0.02em; }
    .field + .field { margin-top: 18px; }
    .field-label { display: block; margin: 0 0 7px; color: #c7cdcb; font-size: 11px; font-weight: 750; letter-spacing: 0.08em; text-transform: uppercase; }
    .select-wrap { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 7px; }
    select {
      width: 100%;
      height: 42px;
      border-color: var(--edge-strong);
      border-radius: 9px;
      padding: 0 34px 0 11px;
      color: var(--ink);
      background-color: var(--raised);
      font-size: 13px;
    }
    select:hover, select:focus { border-color: #52726d; background-color: #1b211f; box-shadow: none; }
    .field-note { min-height: 0; margin: 7px 0 0; color: var(--muted); font-size: 11px; line-height: 1.45; }
    .speed-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
    button { font-family: inherit; }
    .speed-button, .secondary-button, .utility-button, .icon-button, .repair-button, .stop-button {
      border-color: var(--edge-strong);
      color: #c8cfcd;
      background: var(--raised);
      box-shadow: none;
    }
    .secondary-button { height: 42px; border-radius: 9px; padding: 0 12px; font-size: 12px; }
    .speed-button { height: 38px; border-radius: 8px; font-size: 12px; }
    .speed-button[aria-pressed="true"] { border-color: #5e9e94; color: var(--mint-bright); background: #213532; box-shadow: none; }
    .utility-button { min-height: 32px; border-radius: 8px; padding: 0 10px; font-size: 11px; }
    .utility-button:hover, .secondary-button:hover, .speed-button:hover, .icon-button:hover, .stop-button:hover { border-color: #55706c; color: var(--ink); background: #202625; transform: none; }
    .export-box {
      margin-top: 18px;
      border-top: 1px solid var(--edge);
      padding-top: 16px;
    }
    .export-actions { display: flex; gap: 7px; }
    .export-button { flex: 1; }
    .export-download { display: inline-grid; place-items: center; text-decoration: none; }
    .export-download[hidden], .export-cancel[hidden], .export-progress[hidden] { display: none; }
    .export-status { min-height: 16px; margin: 8px 0 0; color: var(--muted); font-size: 10px; line-height: 1.4; }
    .export-status.is-error { color: var(--danger); }
    .export-progress { height: 3px; margin-top: 8px; overflow: hidden; border-radius: 99px; background: #29302f; }
    .export-progress-bar { width: 0; height: 100%; border-radius: inherit; background: var(--mint); }

    details summary {
      min-height: 52px;
      padding: 0 15px;
      color: #d8dcda;
      font-size: 12px;
      font-weight: 700;
    }
    details summary:hover { background: #171b1b; }
    details summary > span:last-child { transition: transform 240ms var(--ease-ui); }
    details[open] summary > span:last-child { transform: rotate(180deg); }
    details[open] .details-body { animation: details-reveal 220ms var(--ease-ui) both; }
    .summary-copy { gap: 8px; }
    .summary-badge { color: var(--muted); background: #202424; font-size: 9px; }
    .details-body { padding: 0 14px 14px; border-top-color: var(--edge); }
    .health-grid { grid-template-columns: 1fr; gap: 0; }
    .health-item { min-height: 54px; grid-template-columns: auto 1fr auto; gap: 8px; padding: 8px 0; border: 0; border-bottom: 1px solid #242929; background: transparent; }
    .health-item:last-child { border-bottom: 0; }
    .health-name, .setting-name { color: #d5dad8; font-size: 11px; }
    .health-detail, .setting-detail { color: var(--muted); font-size: 10px; line-height: 1.35; }
    .health-dot { width: 7px; height: 7px; }
    .repair-button { border-radius: 7px; padding: 6px 8px; font-size: 9px; }
    .shortcut-row, .privacy-row, .cache-row { gap: 10px; padding-top: 12px; }
    .shortcut-row { align-items: flex-start; flex-direction: column; }
    .shortcut-row select { width: 100%; }
    .privacy-toggle { color: #bdc5c3; font-size: 10px; }
    .cache-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-top: 10px;
      border-top: 1px solid var(--edge);
    }
    .health-retry { width: 100%; margin-top: 8px; }
    .recent-list { margin-top: 10px; }
    .recent-item { border-color: var(--edge); border-radius: 9px; background: var(--raised); }

    .player-shell {
      position: sticky;
      z-index: 10;
      bottom: 14px;
      display: grid;
      grid-template-columns: auto minmax(220px, 1fr) auto;
      gap: 16px;
      align-items: center;
      margin: 16px 0 0;
      padding: 11px 12px;
      border: 1px solid var(--edge-strong);
      border-radius: 15px;
      background: rgba(20, 23, 23, 0.97);
      box-shadow: 0 12px 34px rgba(0, 0, 0, 0.38);
      transition: border-color 240ms var(--ease-ui), box-shadow 240ms var(--ease-ui), background-color 240ms var(--ease-ui);
    }
    .transport-actions { display: flex; gap: 7px; }
    .primary-button {
      min-width: 126px;
      height: 46px;
      border: 1px solid #70bbae;
      border-radius: 10px;
      color: #10201d;
      background: var(--mint);
      box-shadow: none;
      font-size: 13px;
      font-weight: 800;
    }
    .primary-button:hover { background: var(--mint-bright); transform: translateY(-1px); box-shadow: 0 7px 18px rgba(89, 189, 173, 0.14); }
    .stop-button { height: 46px; border-radius: 10px; padding: 0 14px; }
    .transport-status { min-width: 0; }
    .status-line { margin-bottom: 7px; color: var(--muted); font-size: 11px; }
    .status-message { overflow: hidden; color: #d6dcda; white-space: nowrap; text-overflow: ellipsis; }
    .status-message.is-changing { animation: status-shift 220ms var(--ease-ui) both; }
    .status-message.is-error { color: #efaaaa; }
    .progress-track { height: 4px; background: #29302f; }
    .progress-bar { background: var(--mint); transition: none; }
    .player-shell.is-running .progress-bar { transition: width 420ms var(--ease-ui); }
    .chunk-actions { display: flex; gap: 6px; }
    .chunk-actions[hidden] { display: none; }
    .icon-button { width: 38px; height: 38px; border-radius: 9px; font-size: 17px; }
    .key-hint {
      margin-left: 9px;
      color: rgba(16, 32, 29, 0.62);
      font: 750 10px/1 "Kokoro Manrope", ui-sans-serif, system-ui, sans-serif;
      letter-spacing: 0.04em;
    }
    button, select, summary {
      transition: color 180ms var(--ease-ui), background-color 180ms var(--ease-ui), border-color 180ms var(--ease-ui), box-shadow 180ms var(--ease-ui), transform 180ms var(--ease-ui), opacity 180ms var(--ease-ui);
    }
    button:active:not(:disabled) { transform: translateY(0) scale(0.98); }
    .connection-dot, .health-dot { transition: background-color 220ms var(--ease-ui), box-shadow 220ms var(--ease-ui), transform 220ms var(--ease-ui); }
    .connection.is-busy .connection-dot { transform: scale(1.16); }

    @keyframes reading-surface-in {
      from { opacity: 0.72; transform: translateY(3px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @keyframes chunk-focus-in {
      from { color: #c8cfcc; background: #17211f; box-shadow: -3px 0 0 rgba(133, 215, 201, 0.18); }
      to { color: #f3f5f1; background: #203a35; box-shadow: -3px 0 0 var(--mint); }
    }
    @keyframes status-shift {
      from { opacity: 0.3; transform: translateY(3px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @keyframes details-reveal {
      from { opacity: 0; transform: translateY(-4px); }
      to { opacity: 1; transform: translateY(0); }
    }

    @media (max-width: 940px) {
      .app-shell { width: min(100% - 28px, 760px); padding-top: 18px; }
      .workspace { grid-template-columns: 1fr; }
      .control-rail { position: static; grid-template-columns: 1fr 1fr; }
      .control-card { grid-row: span 2; }
      textarea { min-height: 62vh; }
      .reading-view { height: 62vh; min-height: 460px; }
    }
    @media (max-width: 620px) {
      .app-shell { width: 100%; padding: 14px 10px 16px; }
      .app-header { margin-bottom: 12px; padding: 0 3px; }
      .brand-mark { width: 34px; height: 34px; border-radius: 9px; }
      h1 { font-size: 17px; }
      .sub { display: none; }
      .connection { padding: 7px 9px; }
      .document-panel { border-radius: 13px; }
      .document-toolbar { min-height: 54px; gap: 10px; padding: 0 12px; }
      .document-title { display: block; max-width: 130px; }
      .document-title h2 { font-size: 11px; }
      .editor-meta { max-width: 130px; margin-top: 2px; font-size: 10px; }
      .editor-actions { flex-wrap: wrap; justify-content: flex-end; }
      .connection [data-connection-label] { display: inline; }
      textarea { min-height: 48vh; padding: 28px 23px 80px; font-size: 18px; line-height: 1.7; }
      .reading-view { height: 48vh; min-height: 0; padding: 28px 23px 80px; font-size: 18px; line-height: 1.7; }
      .control-rail { grid-template-columns: 1fr; padding-bottom: 164px; }
      .control-card { grid-row: auto; }
      .player-shell {
        position: fixed;
        right: 10px;
        bottom: max(8px, env(safe-area-inset-bottom));
        left: 10px;
        grid-template-columns: 1fr auto;
        gap: 10px;
        margin: 0;
        border-radius: 13px;
        padding: 9px;
      }
      .transport-actions { grid-column: 1 / -1; display: grid; grid-template-columns: 1fr auto; }
      .primary-button { width: 100%; }
      .transport-status { grid-column: 1; grid-row: 2; }
      .status-message.is-error {
        display: -webkit-box;
        overflow: hidden;
        white-space: normal;
        line-height: 1.35;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
      }
      .status-message.is-error + [data-progress-label] { display: none; }
      .chunk-actions { grid-column: 2; grid-row: 2; justify-content: flex-end; }
      .key-hint { display: none; }
    }
  </style>
</head>
<body>
  <main class="app-shell" data-reader-app data-listening-desk>
    <header class="app-header">
      <div class="brand">
        <span class="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 64 64" focusable="false">
            <g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
              <path d="M10 49 25 15q3-7 6 0l14 34M17 35h22" stroke-width="5"/>
              <path d="M44 24q9 8 0 16M50 18q15 14 0 28" stroke-width="3.5"/>
            </g>
          </svg>
        </span>
        <div>
          <h1>Aloud</h1>
          <p class="sub">A private listening desk on your Mac.</p>
        </div>
      </div>
      <div class="connection is-connecting" data-connection aria-live="polite" aria-label="Reader status: connecting">
        <span class="connection-dot" aria-hidden="true"></span>
        <span data-connection-label>Connecting</span>
        <button class="connection-retry" type="button" data-retry-reader hidden>Retry</button>
      </div>
    </header>

    <div class="workspace">
      <section class="document-panel" aria-label="Reading text">
        <div class="document-toolbar">
          <div class="document-title">
            <h2>Reading text</h2>
            <div class="editor-meta" data-count>0 words · 0 paragraphs · 0 characters</div>
          </div>
          <div class="editor-actions">
            <input type="file" accept=".txt,.md,.markdown,text/plain,text/markdown" data-file-input hidden>
            <button class="utility-button" type="button" data-open>Open</button>
            <button class="utility-button" type="button" data-paste>Paste</button>
            <button class="utility-button" type="button" data-clear>Clear</button>
          </div>
        </div>
        <div class="document-body">
          <div class="drop-prompt" data-drop-prompt aria-hidden="true"><strong>Drop a text file here</strong><span>.txt, .md, or plain text</span></div>
          <label class="sr-only" for="reader-text">Text to read</label>
          <textarea id="reader-text" data-text placeholder="Paste or type something worth listening to…" spellcheck="true" aria-describedby="reader-text-limit"></textarea>
          <span class="sr-only" id="reader-text-limit">Up to ${MAX_READER_TEXT_CHARACTERS.toLocaleString('en-US')} characters.</span>
          <div class="reading-view" data-reading-view role="document" aria-label="Text being read" tabindex="0" hidden></div>
        </div>
      </section>

      <aside class="control-rail" aria-label="Reading controls">
        <section class="control-card">
          <div class="control-heading">
            <span class="eyebrow">Listening setup</span>
            <h2>Voice &amp; pacing</h2>
          </div>
          <div class="field">
            <label class="field-label" for="engine">Voice model</label>
            <select id="engine" data-engine>
              <option value="kokoro">Kokoro</option>
              <option value="pocket">Pocket TTS</option>
            </select>
            <p class="field-note" data-engine-description>Kokoro provides polished, consistent document narration.</p>
          </div>
          <div class="field">
            <label class="field-label" for="voice">Voice</label>
            <div class="select-wrap">
              <select id="voice" data-voice>${voiceOptions}</select>
              <button class="secondary-button" type="button" data-preview>Preview</button>
            </div>
            <p class="field-note" data-voice-description>Choose a different voice for every reading.</p>
          </div>
          <div class="field">
            <label class="field-label" for="mode">Start behavior</label>
            <select id="mode" data-mode>
              <option value="auto">Balanced</option>
              <option value="fast-start">Fast start</option>
              <option value="smooth">Buffered</option>
            </select>
            <p class="field-note" data-mode-description>Long selections are split automatically and queued ahead.</p>
          </div>
          <div class="field">
            <span class="field-label" id="speed-label">Reading speed</span>
            <div class="speed-row" role="group" aria-labelledby="speed-label">
              <button class="speed-button" type="button" data-rate="0.8" aria-pressed="false">0.8×</button>
              <button class="speed-button" type="button" data-rate="1" aria-pressed="true">1×</button>
              <button class="speed-button" type="button" data-rate="1.25" aria-pressed="false">1.25×</button>
            </div>
            <p class="field-note">Updates an active reading immediately.</p>
          </div>
          <div class="export-box">
            <span class="field-label">Voice file</span>
            <div class="export-actions">
              <button class="secondary-button export-button" type="button" data-export>Save voice file</button>
              <button class="utility-button export-cancel" type="button" data-export-cancel hidden>Cancel</button>
              <a class="utility-button export-download" data-export-download href="#" download hidden>Download again</a>
            </div>
            <p class="export-status" data-export-status role="status" aria-live="polite">Generates long recordings in parts, then joins them into one WAV.</p>
            <div class="export-progress" data-export-progress-track role="progressbar" aria-label="Voice file generation progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" hidden><div class="export-progress-bar" data-export-progress></div></div>
          </div>
        </section>

        <details data-setup>
          <summary>
            <span class="summary-copy">Mac connection <span class="summary-badge" data-health-summary>Checking</span></span>
            <span aria-hidden="true">⌄</span>
          </summary>
          <div class="details-body">
            <div class="health-grid" data-health-grid>
              <div class="health-item" data-health="kokoro"><span class="health-dot" aria-hidden="true"></span><div><span class="health-name">Voice models</span><span class="health-detail">Checking Kokoro and Pocket TTS…</span></div><button class="repair-button" type="button" data-repair="kokoro" aria-label="Set up voice models">Set up</button></div>
              <div class="health-item" data-health="daemon"><span class="health-dot" aria-hidden="true"></span><div><span class="health-name">Shared reader</span><span class="health-detail">Checking daemon…</span></div><button class="repair-button" type="button" data-repair="services" aria-label="Restart Aloud services">Restart</button></div>
              <div class="health-item" data-health="services"><span class="health-dot" aria-hidden="true"></span><div><span class="health-name">Services</span><span class="health-detail">Checking macOS Services…</span></div><button class="repair-button" type="button" data-repair="services" aria-label="Install macOS Services">Install</button></div>
              <div class="health-item" data-health="menuBar"><span class="health-dot" aria-hidden="true"></span><div><span class="health-name">Menu bar</span><span class="health-detail">Checking helper…</span></div><button class="repair-button" type="button" data-repair="services" aria-label="Install menu bar helper">Install</button></div>
              <div class="health-item" data-health="accessibility"><span class="health-dot" aria-hidden="true"></span><div><span class="health-name">Accessibility</span><span class="health-detail">Checking selection access…</span></div><button class="repair-button" type="button" data-repair="accessibility" aria-label="Open Accessibility settings">Open settings</button></div>
            </div>
            <button class="utility-button health-retry" type="button" data-health-retry hidden>Retry connection checks</button>
            <div class="shortcut-row">
              <div><span class="setting-name">Read selection shortcut</span><span class="setting-detail">Used by the menu-bar helper in any Mac app.</span></div>
              <label class="sr-only" for="shortcut">Read selection shortcut</label>
              <select id="shortcut" data-shortcut>${shortcutOptions}</select>
            </div>
          </div>
        </details>

        <details data-history-panel>
          <summary>
            <span class="summary-copy">Reading shelf <span class="summary-badge">Local only</span></span>
            <span aria-hidden="true">⌄</span>
          </summary>
          <div class="details-body">
            <div class="privacy-row">
              <div><span class="setting-name">Remember readings</span><span class="setting-detail">The editor restores its draft. Keep up to five additional items here. Off by default.</span></div>
              <label class="privacy-toggle"><input type="checkbox" data-history-enabled> Enabled</label>
            </div>
            <div class="cache-row" data-cache-row hidden>
              <div><span class="setting-name">Local audio cache</span><span class="setting-detail" data-cache-detail>Checking cached audio…</span></div>
              <button class="utility-button" type="button" data-clear-cache aria-label="Clear local audio cache">Clear audio</button>
            </div>
            <div class="recent-list" data-recent-list></div>
            <div class="history-footer"><button class="utility-button" type="button" data-clear-history disabled>Clear history</button></div>
          </div>
        </details>
      </aside>
    </div>

    <section class="player-shell" aria-label="Playback">
      <div class="transport-actions">
        <button class="primary-button" type="button" data-play aria-keyshortcuts="Control+Enter Meta+Enter" disabled><span data-play-label>Read aloud</span><span class="key-hint" aria-hidden="true">⌘ ↵</span></button>
        <button class="stop-button" type="button" data-stop disabled>Stop</button>
      </div>
      <div class="transport-status">
        <div class="status-line">
          <span class="status-message" data-status role="status" aria-live="polite">Ready to read.</span>
          <span data-progress-label>—</span>
        </div>
        <div class="progress-track" role="progressbar" aria-label="Reading progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" data-progress-track>
          <div class="progress-bar" data-progress></div>
        </div>
      </div>
      <div class="chunk-actions" aria-label="Chunk navigation" data-chunk-actions hidden>
        <button class="icon-button" type="button" data-seek="previous" aria-label="Previous chunk" title="Previous chunk" disabled>‹</button>
        <button class="icon-button" type="button" data-seek="replay" aria-label="Replay chunk" title="Replay chunk" disabled>↺</button>
        <button class="icon-button" type="button" data-seek="next" aria-label="Next chunk" title="Next chunk" disabled>›</button>
      </div>
    </section>
  </main>

  <script>
  (function(){
    var readerApp = document.querySelector('[data-reader-app]');
    var text = document.querySelector('[data-text]');
    var count = document.querySelector('[data-count]');
    var status = document.querySelector('[data-status]');
    var play = document.querySelector('[data-play]');
    var playLabel = document.querySelector('[data-play-label]');
    var stop = document.querySelector('[data-stop]');
    var engine = document.querySelector('[data-engine]');
    var voice = document.querySelector('[data-voice]');
    var mode = document.querySelector('[data-mode]');
    var shortcut = document.querySelector('[data-shortcut]');
    var preview = document.querySelector('[data-preview]');
    var connection = document.querySelector('[data-connection]');
    var connectionLabel = document.querySelector('[data-connection-label]');
    var retryReaderButton = document.querySelector('[data-retry-reader]');
    var progress = document.querySelector('[data-progress]');
    var progressTrack = document.querySelector('[data-progress-track]');
    var progressLabel = document.querySelector('[data-progress-label]');
    var playerShell = document.querySelector('.player-shell');
    var documentPanel = document.querySelector('.document-panel');
    var readingView = document.querySelector('[data-reading-view]');
    var openButton = document.querySelector('[data-open]');
    var fileInput = document.querySelector('[data-file-input]');
    var pasteButton = document.querySelector('[data-paste]');
    var clearButton = document.querySelector('[data-clear]');
    var chunkActions = document.querySelector('[data-chunk-actions]');
    var historyEnabled = document.querySelector('[data-history-enabled]');
    var recentList = document.querySelector('[data-recent-list]');
    var clearHistoryButton = document.querySelector('[data-clear-history]');
    var healthRetryButton = document.querySelector('[data-health-retry]');
    var cacheRow = document.querySelector('[data-cache-row]');
    var cacheDetail = document.querySelector('[data-cache-detail]');
    var clearCacheButton = document.querySelector('[data-clear-cache]');
    var exportButton = document.querySelector('[data-export]');
    var exportCancelButton = document.querySelector('[data-export-cancel]');
    var exportDownload = document.querySelector('[data-export-download]');
    var exportStatus = document.querySelector('[data-export-status]');
    var exportProgress = document.querySelector('[data-export-progress]');
    var exportProgressTrack = document.querySelector('[data-export-progress-track]');
    var currentStatus = null;
    var requestBusy = false;
    var readerReachable = false;
    var healthRepairRunning = false;
    var healthUnavailable = false;
    var cacheAvailable = false;
    var cacheEntries = 0;
    var statusTimer = null;
    var healthTimer = null;
    var statusPollInFlight = null;
    var healthPollInFlight = null;
    var statusPollGeneration = 0;
    var activeChunkKey = '';
    var ownedJobId = null;
    var restoreEditorFocus = false;
    var dragDepth = 0;
    var lastClearedText = '';
    var hasEditorUndo = false;
    var clearUndoTimer = null;
    var localStatusUntil = 0;
    var playbackEndedAt = 0;
    var storageWarningShown = false;
    var currentExportId = null;
    var exportTimer = null;
    var exportRunning = false;
    var exportAutoDownloadId = null;
    var MAX_TEXT_CHARACTERS = ${MAX_READER_TEXT_CHARACTERS};
    var MAX_FILE_BYTES = ${MAX_READER_FILE_BYTES};
    var STATUS_ACTIVE_POLL_MS = 750;
    var STATUS_IDLE_POLL_MS = 5000;
    var HEALTH_READY_POLL_MS = 60000;
    var HEALTH_RETRY_POLL_MS = 30000;
    var TEXT_KEY = 'aloud-text';
    var HISTORY_KEY = 'aloud-history';
    var HISTORY_ENABLED_KEY = 'aloud-history-enabled';
    var EXPORT_KEY = 'aloud-current-export';
    var LEGACY_STORAGE_KEYS = {
      'kokoro-reader-text': TEXT_KEY,
      'kokoro-reader-history': HISTORY_KEY,
      'kokoro-reader-history-enabled': HISTORY_ENABLED_KEY,
      'kokoro-reader-current-export': EXPORT_KEY
    };

    function warnStorageUnavailable(){
      if(storageWarningShown) return;
      storageWarningShown = true;
      setLocalStatus('Draft saving and reading history are unavailable in this browser. Text still works for this session.', true, 6000);
    }

    function readStorage(key, fallback){
      try {
        var value = window.localStorage.getItem(key);
        return value === null ? fallback : value;
      } catch(error) {
        warnStorageUnavailable();
        return fallback;
      }
    }

    function writeStorage(key, value){
      try {
        window.localStorage.setItem(key, value);
        return true;
      } catch(error) {
        warnStorageUnavailable();
        return false;
      }
    }

    function removeStorage(key){
      try {
        window.localStorage.removeItem(key);
        return true;
      } catch(error) {
        warnStorageUnavailable();
        return false;
      }
    }

    function migrateLegacyStorage(){
      Object.keys(LEGACY_STORAGE_KEYS).forEach(function(oldKey){
        var newKey = LEGACY_STORAGE_KEYS[oldKey];
        if(readStorage(newKey, null) !== null) return;
        var value = readStorage(oldKey, null);
        if(value === null) return;
        if(writeStorage(newKey, value)) removeStorage(oldKey);
      });
    }

    function requestJson(path, options){
      var config = options || {};
      if(config.body && typeof config.body !== 'string'){
        config = Object.assign({}, config, {
          body: JSON.stringify(config.body),
          headers: Object.assign({ 'Content-Type': 'application/json' }, config.headers || {})
        });
      }
      return fetch(path, config).then(function(response){
        return response.json().catch(function(){ return {}; }).then(function(body){
          if(!response.ok) throw new Error(body.error || 'Aloud request failed.');
          return body;
        });
      });
    }

    function post(path, body){
      return requestJson(path, { method: 'POST', body: body });
    }

    function setStatus(message, error, force){
      if(!force && Date.now() < localStatusUntil) return;
      var nextMessage = message || 'Ready to read.';
      if(status.textContent !== nextMessage){
        status.classList.remove('is-changing');
        status.textContent = nextMessage;
        void status.offsetWidth;
        status.classList.add('is-changing');
      }
      status.classList.toggle('is-error', !!error);
    }

    function setLocalStatus(message, error, duration){
      localStatusUntil = Date.now() + (duration || 2800);
      setStatus(message, error, true);
    }

    function isPlaybackRunning(){
      return !!(currentStatus && currentStatus.running);
    }

    function isInteractionLocked(){
      return requestBusy || isPlaybackRunning();
    }

    function resetClearUndo(){
      if(clearUndoTimer) clearTimeout(clearUndoTimer);
      clearUndoTimer = null;
      hasEditorUndo = false;
      lastClearedText = '';
      clearButton.textContent = 'Clear';
      clearButton.setAttribute('aria-label', 'Clear reading text');
      clearButton.removeAttribute('data-undo-clear');
    }

    function armEditorUndo(previousValue, action){
      resetClearUndo();
      hasEditorUndo = true;
      lastClearedText = previousValue;
      clearButton.textContent = 'Undo';
      clearButton.setAttribute('aria-label', 'Undo ' + action);
      clearButton.setAttribute('data-undo-clear', '');
      clearUndoTimer = setTimeout(function(){ resetClearUndo(); updateCounts(); }, 8000);
    }

    function validateTextLength(value){
      if(String(value || '').length <= MAX_TEXT_CHARACTERS) return true;
      setLocalStatus('That text is too long. Aloud accepts up to ' + MAX_TEXT_CHARACTERS.toLocaleString() + ' characters.', true, 6000);
      return false;
    }

    function setEditorText(value, message, undoAction){
      var nextValue = String(value || '');
      if(!validateTextLength(nextValue)) return false;
      var previousValue = text.value || '';
      if(nextValue !== previousValue && undoAction) armEditorUndo(previousValue, undoAction);
      else resetClearUndo();
      text.value = nextValue;
      var saved = writeStorage(TEXT_KEY, text.value);
      updateCounts();
      text.focus({ preventScroll: true });
      if(message && saved) setLocalStatus(message);
      return true;
    }

    function readLocalTextFile(file){
      if(!file) return Promise.resolve();
      if(isInteractionLocked()){
        setLocalStatus('Wait for the current reading action to finish before replacing the text.', true);
        return Promise.resolve();
      }
      var name = String(file.name || 'text file');
      var supportedName = /\.(txt|md|markdown)$/i.test(name);
      var supportedType = !file.type || /^text\//i.test(file.type);
      if(!supportedName && !supportedType){
        setLocalStatus('Choose a plain text or Markdown file.', true);
        return Promise.resolve();
      }
      if(file.size > MAX_FILE_BYTES){
        setLocalStatus('That file is larger than 1 MB. Choose a smaller text file.', true);
        return Promise.resolve();
      }
      return file.text().then(function(value){
        if(isInteractionLocked()){
          setLocalStatus('The file was not opened because reading started first.', true);
          return;
        }
        setEditorText(value, 'Opened ' + name + '. Undo is available for a few seconds.', 'opening ' + name);
      }).catch(function(){
        setLocalStatus('Could not read that local file.', true);
      }).finally(function(){
        fileInput.value = '';
      });
    }

    function hideReadingHighlight(){
      if(readingView.hidden) return;
      var readingHadFocus = document.activeElement === readingView;
      var shouldRestoreFocus = readingHadFocus || (restoreEditorFocus && document.activeElement === document.body);
      text.scrollTop = readingView.scrollTop;
      readingView.hidden = true;
      readingView.textContent = '';
      text.hidden = false;
      text.removeAttribute('aria-hidden');
      documentPanel.classList.remove('is-reading');
      activeChunkKey = '';
      restoreEditorFocus = false;
      if(shouldRestoreFocus){
        requestAnimationFrame(function(){ text.focus({ preventScroll: true }); });
      }
    }

    function renderReadingHighlight(next, state){
      var source = text.value || '';
      var start = Number(state.chunkStart);
      var end = Number(state.chunkEnd);
      var validRange = Number.isInteger(start)
        && Number.isInteger(end)
        && start >= 0
        && end > start
        && end <= source.length;
      if(!next.running || !validRange || !ownedJobId || next.jobId !== ownedJobId){
        hideReadingHighlight();
        return;
      }

      readingView.classList.toggle('is-paused', !!next.paused);
      var key = String(start) + ':' + String(end);
      if(!readingView.hidden && activeChunkKey === key) return;

      var previousScroll = readingView.hidden ? text.scrollTop : readingView.scrollTop;
      var active = document.createElement('span');
      active.className = 'active-chunk';
      active.setAttribute('data-active-chunk', '');
      active.setAttribute('aria-current', 'true');
      source.slice(start, end).split(/(\n+)/).forEach(function(part){
        if(!part) return;
        if(/^\n+$/.test(part)){
          active.appendChild(document.createTextNode(part));
          return;
        }
        var segment = document.createElement('mark');
        segment.className = 'active-chunk-segment';
        segment.appendChild(document.createTextNode(part));
        active.appendChild(segment);
      });
      readingView.replaceChildren(
        document.createTextNode(source.slice(0, start)),
        active,
        document.createTextNode(source.slice(end)),
      );
      readingView.hidden = false;
      readingView.scrollTop = previousScroll;
      if(document.activeElement === text) restoreEditorFocus = true;
      text.hidden = true;
      text.setAttribute('aria-hidden', 'true');
      documentPanel.classList.add('is-reading');
      activeChunkKey = key;

      if(restoreEditorFocus) readingView.focus({ preventScroll: true });

      requestAnimationFrame(function(){
        var target = Math.max(0, active.offsetTop - Math.max(24, (readingView.clientHeight - active.offsetHeight) / 2));
        var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        readingView.scrollTo({ top: target, behavior: reduced ? 'auto' : 'smooth' });
      });
    }

    function updateCounts(){
      var value = text.value || '';
      var words = value.trim() ? value.trim().split(/\s+/).length : 0;
      var paragraphs = value.trim() ? value.trim().split(/\n\s*\n+/).length : 0;
      count.textContent = String(words) + (words === 1 ? ' word' : ' words') + ' · ' + String(paragraphs) + (paragraphs === 1 ? ' paragraph' : ' paragraphs') + ' · ' + String(value.length) + (value.length === 1 ? ' character' : ' characters');
      text.setAttribute('aria-invalid', value.length > MAX_TEXT_CHARACTERS ? 'true' : 'false');
      syncInteractionState();
    }

    function syncInteractionState(){
      var running = isPlaybackRunning();
      var replacingLocked = requestBusy || running;
      var hasText = !!(text.value || '').trim();
      var textTooLong = (text.value || '').length > MAX_TEXT_CHARACTERS;
      readerApp.setAttribute('aria-busy', requestBusy ? 'true' : 'false');
      playerShell.setAttribute('aria-busy', requestBusy ? 'true' : 'false');
      documentPanel.setAttribute('aria-busy', requestBusy ? 'true' : 'false');
      text.readOnly = replacingLocked;
      fileInput.disabled = replacingLocked;
      openButton.disabled = replacingLocked;
      pasteButton.disabled = replacingLocked;
      clearButton.disabled = replacingLocked || (!hasText && !hasEditorUndo);
      play.disabled = requestBusy || !readerReachable || (!running && (!hasText || textTooLong));
      stop.disabled = requestBusy || !readerReachable || !running;
      preview.disabled = requestBusy || running || !readerReachable;
      engine.disabled = requestBusy || running || !readerReachable;
      voice.disabled = requestBusy || running || !readerReachable;
      mode.disabled = requestBusy || running || !readerReachable;
      shortcut.disabled = requestBusy || !readerReachable;
      historyEnabled.disabled = replacingLocked;
      clearHistoryButton.disabled = replacingLocked || loadHistory().length === 0;
      document.querySelectorAll('[data-restore]').forEach(function(button){ button.disabled = replacingLocked; });
      document.querySelectorAll('[data-rate]').forEach(function(button){ button.disabled = requestBusy || !readerReachable; });
      document.querySelectorAll('[data-repair]').forEach(function(button){ button.disabled = requestBusy || running || healthRepairRunning; });
      healthRetryButton.disabled = requestBusy || running;
      clearCacheButton.disabled = replacingLocked || !cacheAvailable || cacheEntries <= 0;
      exportButton.disabled = exportRunning || requestBusy || !hasText || textTooLong;
      exportCancelButton.disabled = !exportRunning;

      var next = currentStatus || {};
      document.querySelector('[data-seek="previous"]').disabled = requestBusy || !readerReachable || !next.canGoPrevious;
      document.querySelector('[data-seek="replay"]').disabled = requestBusy || !readerReachable || !next.canReplay;
      document.querySelector('[data-seek="next"]').disabled = requestBusy || !readerReachable || !next.canGoNext;
    }

    function selectedDescription(select){
      var option = select.options[select.selectedIndex];
      return option ? option.getAttribute('data-description') || '' : '';
    }

    function updateVoiceDescription(){
      document.querySelector('[data-voice-description]').textContent = selectedDescription(voice);
    }

    function updateEngineDescription(){
      document.querySelector('[data-engine-description]').textContent = engine.value === 'pocket'
        ? 'Pocket TTS starts quickly and offers a larger English voice catalog.'
        : 'Kokoro provides polished, consistent document narration.';
      if(!currentExportId && !exportRunning){
        exportStatus.textContent = engine.value === 'pocket'
          ? 'Pocket exports use the voice model’s natural 1× speed. Live reading still follows your selected speed.'
          : 'Generates long recordings in parts, then joins them into one WAV.';
      }
    }

    function syncEngineVoices(engineValue, preferredVoice){
      var activeGroup = null;
      document.querySelectorAll('[data-engine-options]').forEach(function(group){
        var active = group.getAttribute('data-engine-options') === engineValue;
        group.hidden = !active;
        group.disabled = !active;
        if(active) activeGroup = group;
      });
      var preferred = preferredVoice && activeGroup
        ? Array.from(activeGroup.querySelectorAll('option')).find(function(option){ return option.value === String(preferredVoice); })
        : null;
      var next = preferred || (activeGroup && activeGroup.querySelector('option'));
      if(next) voice.value = next.value;
      updateEngineDescription();
      updateVoiceDescription();
    }

    function updateModeDescription(){
      var descriptions = {
        auto: 'Long selections are split automatically and queued ahead.',
        'fast-start': 'Prioritizes the shortest possible startup time.',
        smooth: 'Uses larger chunks and keeps more speech ready to avoid gaps.'
      };
      document.querySelector('[data-mode-description]').textContent = descriptions[mode.value] || descriptions.auto;
    }

    function renderStatus(next){
      var wasRunning = !!(currentStatus && currentStatus.running);
      currentStatus = next;
      readerReachable = true;
      retryReaderButton.hidden = true;
      connection.classList.remove('is-connecting', 'is-ready', 'is-busy', 'is-error');
      connection.classList.add(next.running ? 'is-busy' : 'is-ready');
      playerShell.classList.toggle('is-running', !!next.running);
      connectionLabel.textContent = next.running ? (next.paused ? 'Paused' : 'Reading') : 'Local · Ready';
      connection.setAttribute('aria-label', 'Reader status: ' + connectionLabel.textContent);
      if(document.activeElement !== engine) engine.value = next.engine || 'kokoro';
      if(document.activeElement !== voice && document.activeElement !== engine) syncEngineVoices(engine.value, next.voice);
      if(document.activeElement !== mode) mode.value = next.mode || 'auto';
      if(document.activeElement !== shortcut) shortcut.value = next.shortcut || 'option+r';
      updateVoiceDescription();
      updateModeDescription();
      document.querySelectorAll('[data-rate]').forEach(function(button){
        button.setAttribute('aria-pressed', Math.abs(Number(button.getAttribute('data-rate')) - Number(next.rate || 1)) < 0.02 ? 'true' : 'false');
      });

      var state = next.state || {};
      if(!next.running && wasRunning){
        playbackEndedAt = Date.now();
        setLocalStatus(state.message || 'Finished reading.', state.status === 'error', 3200);
        refreshCache();
      } else if(next.running) {
        playbackEndedAt = 0;
        setStatus(
          next.paused ? 'Paused.' : (next.running ? state.message || 'Reading…' : 'Ready to read.'),
          next.running && state.status === 'error',
        );
      } else if(state.status === 'error') {
        setStatus(state.message || 'The last reading failed.', true);
      } else {
        setStatus('Ready to read.', false);
      }
      playLabel.textContent = next.running ? (next.paused ? 'Resume' : 'Pause') : 'Read aloud';
      chunkActions.hidden = !(next.canGoPrevious || next.canReplay || next.canGoNext);

      var total = Number(state.total || 0);
      var current = Number(state.current || 0);
      var showingCompletion = !next.running && playbackEndedAt > 0 && Date.now() - playbackEndedAt < 3200;
      var completedChunks = next.running ? Math.max(0, current - 1) : (showingCompletion ? total : 0);
      var percent = total > 0 ? Math.max(0, Math.min(100, Math.round((completedChunks / total) * 100))) : 0;
      progress.style.width = String(percent) + '%';
      progressTrack.setAttribute('aria-valuenow', String(percent));
      progressTrack.setAttribute('aria-valuetext', next.running && total > 0
        ? 'Reading chunk ' + String(Math.max(1, current)) + ' of ' + String(total)
        : (showingCompletion ? 'Reading complete' : 'Ready'));
      progressLabel.textContent = next.running || showingCompletion
        ? (total > 1 ? String(Math.max(1, current)) + ' / ' + String(total) : next.voiceLabel + ' · ' + next.rate + '×')
        : '—';

      renderReadingHighlight(next, state);
      syncInteractionState();
      if(!document.hidden) scheduleStatusPoll(next.running ? STATUS_ACTIVE_POLL_MS : STATUS_IDLE_POLL_MS);
    }

    function markOffline(error){
      readerReachable = false;
      connection.classList.remove('is-connecting', 'is-ready', 'is-busy');
      connection.classList.add('is-error');
      connectionLabel.textContent = 'Reader unavailable';
      connection.setAttribute('aria-label', 'Reader status: unavailable');
      retryReaderButton.hidden = false;
      setStatus(error && error.message ? error.message : 'Could not reach the local reader.', true, true);
      hideReadingHighlight();
      syncInteractionState();
    }

    function refreshStatus(){
      if(statusPollInFlight) return statusPollInFlight;
      var generation = statusPollGeneration;
      statusPollInFlight = requestJson('/api/reader/status')
        .then(function(next){ if(generation === statusPollGeneration) renderStatus(next); })
        .catch(function(error){ if(generation === statusPollGeneration) markOffline(error); })
        .finally(function(){ statusPollInFlight = null; });
      return statusPollInFlight;
    }

    function withBusy(operation){
      if(requestBusy) return Promise.resolve();
      var focusBeforeRequest = document.activeElement;
      var restoreControlFocus = focusBeforeRequest
        && focusBeforeRequest !== document.body
        && focusBeforeRequest !== text
        && focusBeforeRequest !== readingView
        && typeof focusBeforeRequest.focus === 'function';
      if(restoreControlFocus) restoreEditorFocus = false;
      localStatusUntil = 0;
      requestBusy = true;
      statusPollGeneration += 1;
      syncInteractionState();
      return Promise.resolve().then(operation).then(function(next){
        if(next && next.ok && typeof next.running === 'boolean') renderStatus(next);
        return next;
      }).catch(function(error){
        setLocalStatus(error.message || 'Aloud request failed.', true, 6000);
      }).finally(function(){
        requestBusy = false;
        updateCounts();
        if(restoreControlFocus){
          requestAnimationFrame(function(){
            if(document.activeElement === document.body && document.contains(focusBeforeRequest) && !focusBeforeRequest.disabled){
              focusBeforeRequest.focus({ preventScroll: true });
            }
          });
        }
        var pendingStatus = statusPollInFlight;
        if(pendingStatus) pendingStatus.finally(refreshStatus);
        else refreshStatus();
      });
    }

    function updateSettings(settings){
      return withBusy(function(){ return post('/api/reader/settings', settings); });
    }

    function playOrPause(){
      if(!readerReachable){
        setLocalStatus('The local reader is unavailable. Retry the connection first.', true, 5000);
        return;
      }
      if(currentStatus && currentStatus.running){
        return withBusy(function(){ return post('/api/reader/control', { action: currentStatus.paused ? 'resume' : 'pause' }); });
      }
      var value = text.value || '';
      if(!value.trim()){ setLocalStatus('Paste or type some text first.', true); return; }
      if(!validateTextLength(value)) return;
      saveRecent(value);
      ownedJobId = null;
      return withBusy(function(){
        setStatus('Preparing text…');
        return post('/api/reader/speak', {
          engine: engine.value,
          mode: mode.value,
          rate: selectedRate(),
          text: value,
          voice: voice.value
        }).then(function(next){
          ownedJobId = next && next.jobId ? next.jobId : null;
          return next;
        });
      });
    }

    function selectedRate(){
      var selected = document.querySelector('[data-rate][aria-pressed="true"]');
      return selected ? Number(selected.getAttribute('data-rate')) : 1;
    }

    function renderExport(next){
      if(!next) return;
      currentExportId = next.id || currentExportId;
      exportRunning = next.state === 'queued' || next.state === 'generating';
      var percent = Math.max(0, Math.min(100, Number(next.progress || 0)));
      exportProgress.style.width = String(percent) + '%';
      exportProgressTrack.setAttribute('aria-valuenow', String(percent));
      exportProgressTrack.hidden = !exportRunning && next.state !== 'ready';
      exportCancelButton.hidden = !exportRunning;
      exportDownload.hidden = next.state !== 'ready' || !next.downloadUrl;
      exportStatus.classList.toggle('is-error', next.state === 'error');
      exportStatus.textContent = next.message || 'Preparing voice file…';
      exportButton.textContent = exportRunning ? 'Generating voice file…' : 'Save voice file';
      if(next.state === 'ready' && next.downloadUrl){
        exportDownload.href = next.downloadUrl;
        exportDownload.setAttribute('download', next.filename || 'kokoro-reading.wav');
        if(exportAutoDownloadId === next.id){
          exportAutoDownloadId = null;
          exportDownload.click();
        }
      }
      if(!exportRunning && exportTimer){ clearTimeout(exportTimer); exportTimer = null; }
      syncInteractionState();
    }

    function scheduleExportPoll(delay){
      if(exportTimer) clearTimeout(exportTimer);
      if(!currentExportId || !exportRunning || document.hidden) return;
      exportTimer = setTimeout(refreshExport, delay || 900);
    }

    function refreshExport(){
      if(!currentExportId) return Promise.resolve();
      return requestJson('/api/exports/' + encodeURIComponent(currentExportId)).then(function(next){
        renderExport(next);
        if(exportRunning) scheduleExportPoll(900);
        return next;
      }).catch(function(error){
        if(exportTimer) clearTimeout(exportTimer);
        exportTimer = null;
        exportRunning = false;
        currentExportId = null;
        removeStorage(EXPORT_KEY);
        exportStatus.classList.add('is-error');
        exportStatus.textContent = error.message || 'Could not check the voice export.';
        syncInteractionState();
      });
    }

    function startVoiceExport(){
      var value = text.value || '';
      if(!value.trim()){ setLocalStatus('Paste or type some text first.', true); return; }
      if(!validateTextLength(value)) return;
      exportRunning = true;
      exportDownload.hidden = true;
      exportCancelButton.hidden = false;
      exportProgressTrack.hidden = false;
      exportProgress.style.width = '0%';
      exportStatus.classList.remove('is-error');
      exportStatus.textContent = 'Preparing voice file export…';
      exportButton.textContent = 'Generating voice file…';
      syncInteractionState();
      saveRecent(value);
      return post('/api/exports', {
        engine: engine.value,
        rate: selectedRate(),
        text: value,
        voice: voice.value
      }).then(function(next){
        currentExportId = next.id;
        exportAutoDownloadId = next.id;
        writeStorage(EXPORT_KEY, next.id);
        renderExport(next);
        scheduleExportPoll(250);
      }).catch(function(error){
        exportRunning = false;
        exportCancelButton.hidden = true;
        exportProgressTrack.hidden = true;
        exportButton.textContent = 'Save voice file';
        exportStatus.classList.add('is-error');
        exportStatus.textContent = error.message || 'Could not start the voice export.';
        syncInteractionState();
      });
    }

    function cancelVoiceExport(){
      if(!currentExportId || !exportRunning) return;
      exportCancelButton.disabled = true;
      return post('/api/exports/' + encodeURIComponent(currentExportId) + '/cancel', {}).then(function(next){
        exportAutoDownloadId = null;
        removeStorage(EXPORT_KEY);
        renderExport(next);
      }).catch(function(error){
        exportStatus.classList.add('is-error');
        exportStatus.textContent = error.message || 'Could not cancel the voice export.';
        exportCancelButton.disabled = false;
      });
    }

    function previewVoice(){
      var option = voice.options[voice.selectedIndex];
      var label = option ? option.textContent : 'the selected voice';
      var engineLabel = engine.value === 'pocket' ? 'Pocket TTS' : 'Kokoro';
      return withBusy(function(){
        setStatus('Preparing voice preview…');
        return post('/api/reader/speak', {
          engine: engine.value,
          mode: 'smooth',
          rate: selectedRate(),
          text: label + ' is ready to read with ' + engineLabel + '.',
          voice: voice.value
        });
      });
    }

    function loadHistory(){
      try {
        var value = JSON.parse(readStorage(HISTORY_KEY, '[]') || '[]');
        return Array.isArray(value) ? value.filter(function(item){ return item && typeof item.text === 'string'; }).slice(0, 5) : [];
      } catch(e) { return []; }
    }

    function saveRecent(value){
      if(!historyEnabled.checked) return;
      var items = loadHistory().filter(function(item){ return item.text !== value; });
      items.unshift({ text: value, savedAt: Date.now() });
      writeStorage(HISTORY_KEY, JSON.stringify(items.slice(0, 5)));
      renderHistory();
    }

    function historyTitle(value){
      return value.replace(/\s+/g, ' ').trim().slice(0, 80) || 'Untitled reading';
    }

    function renderHistory(){
      var items = loadHistory();
      recentList.textContent = '';
      if(!items.length){
        var empty = document.createElement('p');
        empty.className = 'recent-empty';
        empty.textContent = historyEnabled.checked ? 'Read something to add it here.' : 'Enable history to keep recent readings on this Mac.';
        recentList.appendChild(empty);
        syncInteractionState();
        return;
      }
      items.forEach(function(item, index){
        var row = document.createElement('div');
        row.className = 'recent-item';
        var copy = document.createElement('div');
        var title = document.createElement('div');
        title.className = 'recent-title';
        var itemTitle = historyTitle(item.text);
        title.textContent = itemTitle;
        var meta = document.createElement('div');
        meta.className = 'recent-meta';
        meta.textContent = String(item.text.trim().split(/\s+/).length) + ' words';
        copy.appendChild(title);
        copy.appendChild(meta);
        var restore = document.createElement('button');
        restore.className = 'utility-button';
        restore.type = 'button';
        restore.textContent = 'Restore';
        restore.setAttribute('data-restore', String(index));
        restore.setAttribute('aria-label', 'Restore “' + itemTitle + '”');
        row.appendChild(copy);
        row.appendChild(restore);
        recentList.appendChild(row);
      });
      syncInteractionState();
    }

    function renderHealth(health){
      var names = ['kokoro', 'daemon', 'services', 'menuBar', 'accessibility'];
      var ready = 0;
      healthUnavailable = false;
      healthRetryButton.hidden = true;
      healthRepairRunning = !!(health.repair && health.repair.running);
      names.forEach(function(name){
        var item = document.querySelector('[data-health="' + name + '"]');
        var check = health[name] || { state: 'unknown', detail: 'Status unavailable.' };
        item.classList.toggle('is-ready', check.state === 'ready');
        item.classList.toggle('needs-action', check.state === 'needs-action');
        item.querySelector('.health-detail').textContent = check.detail;
        var button = item.querySelector('[data-repair]');
        if(button) button.hidden = check.state === 'ready';
        if(check.state === 'ready') ready += 1;
      });
      var summary = document.querySelector('[data-health-summary]');
      summary.textContent = ready === names.length ? 'Ready' : String(ready) + ' of ' + String(names.length) + ' ready';
      if(health.repair && health.repair.message) setLocalStatus(health.repair.message, !health.repair.running && /failed/i.test(health.repair.message), 5000);
      syncInteractionState();
    }

    function markHealthUnavailable(){
      var firstFailure = !healthUnavailable;
      healthUnavailable = true;
      healthRepairRunning = false;
      healthRetryButton.hidden = false;
      document.querySelector('[data-health-summary]').textContent = 'Unavailable';
      document.querySelectorAll('[data-health]').forEach(function(item){
        item.classList.remove('is-ready');
        item.classList.add('needs-action');
        item.querySelector('.health-detail').textContent = 'Could not check this connection.';
        var button = item.querySelector('[data-repair]');
        if(button) button.hidden = true;
      });
      if(firstFailure && readerReachable && !isPlaybackRunning()) setLocalStatus('Mac connection checks are unavailable. Retry when the reader is ready.', true, 5000);
      syncInteractionState();
    }

    function refreshHealth(){
      if(healthPollInFlight) return healthPollInFlight;
      healthPollInFlight = requestJson('/api/system/health')
        .then(renderHealth)
        .catch(markHealthUnavailable)
        .finally(function(){ healthPollInFlight = null; });
      return healthPollInFlight;
    }

    function formatBytes(value){
      var bytes = Math.max(0, Number(value || 0));
      if(bytes < 1024) return String(bytes) + ' B';
      if(bytes < 1024 * 1024) return (bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0) + ' KB';
      return (bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0) + ' MB';
    }

    function renderCache(cache){
      var entries = Number(cache.entries ?? cache.files ?? cache.count ?? 0);
      var bytes = Number(cache.bytes ?? cache.sizeBytes ?? cache.totalBytes ?? 0);
      cacheAvailable = true;
      cacheEntries = Math.max(0, entries);
      cacheRow.hidden = false;
      cacheDetail.textContent = cacheEntries > 0
        ? String(cacheEntries) + (cacheEntries === 1 ? ' audio file · ' : ' audio files · ') + formatBytes(bytes)
        : 'No generated audio is cached.';
      syncInteractionState();
    }

    function refreshCache(){
      return requestJson('/api/system/cache').then(renderCache).catch(function(){
        cacheAvailable = false;
        cacheEntries = 0;
        cacheRow.hidden = true;
        syncInteractionState();
      });
    }

    function scheduleStatusPoll(delay){
      if(statusTimer) clearTimeout(statusTimer);
      if(document.hidden) { statusTimer = null; return; }
      statusTimer = setTimeout(runStatusPoll, delay);
    }

    function scheduleHealthPoll(delay){
      if(healthTimer) clearTimeout(healthTimer);
      if(document.hidden) { healthTimer = null; return; }
      healthTimer = setTimeout(runHealthPoll, delay);
    }

    function runStatusPoll(){
      statusTimer = null;
      if(document.hidden) return;
      if(requestBusy){
        scheduleStatusPoll(STATUS_ACTIVE_POLL_MS);
        return;
      }
      refreshStatus().finally(function(){
        scheduleStatusPoll(readerReachable && isPlaybackRunning() ? STATUS_ACTIVE_POLL_MS : STATUS_IDLE_POLL_MS);
      });
    }

    function runHealthPoll(){
      healthTimer = null;
      if(document.hidden) return;
      refreshHealth().finally(function(){
        scheduleHealthPoll(healthUnavailable ? HEALTH_RETRY_POLL_MS : HEALTH_READY_POLL_MS);
      });
    }

    document.addEventListener('click', function(event){
      var target = event.target;
      if(target.closest('[data-play]')){ playOrPause(); return; }
      if(target.closest('[data-stop]')){ withBusy(function(){ return post('/api/reader/control', { action: 'stop' }); }); return; }
      if(target.closest('[data-preview]')){ previewVoice(); return; }
      if(target.closest('[data-export-cancel]')){ cancelVoiceExport(); return; }
      if(target.closest('[data-export]')){ startVoiceExport(); return; }
      if(target.closest('[data-retry-reader]')){
        connection.classList.remove('is-error', 'is-ready', 'is-busy');
        connection.classList.add('is-connecting');
        connectionLabel.textContent = 'Reconnecting';
        connection.setAttribute('aria-label', 'Reader status: reconnecting');
        retryReaderButton.hidden = true;
        setStatus('Trying to reconnect to the local reader…', false, true);
        refreshStatus();
        refreshHealth();
        refreshCache();
        return;
      }
      if(target.closest('[data-health-retry]')){ refreshHealth(); return; }
      var rateButton = target.closest('[data-rate]');
      if(rateButton){
        updateSettings({ rate: Number(rateButton.getAttribute('data-rate')) });
        return;
      }
      var seek = target.closest('[data-seek]');
      if(seek){ withBusy(function(){ return post('/api/reader/seek', { action: seek.getAttribute('data-seek') }); }); return; }
      if(target.closest('[data-clear]')){
        if(isInteractionLocked()) return;
        if(hasEditorUndo){
          var restoredText = lastClearedText;
          setEditorText(restoredText, 'Text restored.');
          return;
        }
        if(!text.value) return;
        var clearedText = text.value;
        armEditorUndo(clearedText, 'clearing the text');
        text.value = '';
        var draftRemoved = removeStorage(TEXT_KEY);
        updateCounts();
        setLocalStatus(draftRemoved
          ? 'Text cleared. Undo is available for a few seconds.'
          : 'Text cleared for this session, but the saved draft could not be removed.', !draftRemoved, 6000);
        text.focus();
        return;
      }
      if(target.closest('[data-open]')){
        if(isInteractionLocked()) return;
        fileInput.click();
        return;
      }
      if(target.closest('[data-paste]')){
        if(isInteractionLocked()) return;
        if(!navigator.clipboard || !navigator.clipboard.readText){ setLocalStatus('Clipboard access is unavailable in this browser.', true); return; }
        navigator.clipboard.readText().then(function(value){
          if(isInteractionLocked()){
            setLocalStatus('The clipboard was not pasted because reading started first.', true);
            return;
          }
          if(!value){ setLocalStatus('The clipboard does not contain text.', true); return; }
          setEditorText(value, 'Pasted from the clipboard. Undo is available for a few seconds.', 'pasting from the clipboard');
        }).catch(function(){ setLocalStatus('Allow clipboard access, then try Paste again.', true); });
        return;
      }
      var repair = target.closest('[data-repair]');
      if(repair){
        withBusy(function(){ return post('/api/system/repair', { action: repair.getAttribute('data-repair') }); }).then(refreshHealth);
        return;
      }
      var restore = target.closest('[data-restore]');
      if(restore){
        if(isInteractionLocked()) return;
        var item = loadHistory()[Number(restore.getAttribute('data-restore'))];
        if(item) setEditorText(item.text, 'Reading restored. Undo is available for a few seconds.', 'restoring a saved reading');
        return;
      }
      if(target.closest('[data-clear-history]')){
        if(isInteractionLocked() || !loadHistory().length) return;
        if(!removeStorage(HISTORY_KEY)) return;
        renderHistory();
        setLocalStatus('Reading history cleared.');
        return;
      }
      if(target.closest('[data-clear-cache]')){
        if(isInteractionLocked() || !cacheAvailable || cacheEntries <= 0) return;
        withBusy(function(){ return post('/api/system/cache', { action: 'clear' }); }).then(function(result){
          if(!result) return;
          setLocalStatus('Local audio cache cleared.');
          return refreshCache();
        });
      }
    });

    engine.addEventListener('change', function(){
      syncEngineVoices(engine.value);
      updateSettings({ engine: engine.value, voice: voice.value });
    });
    voice.addEventListener('change', function(){ updateVoiceDescription(); updateSettings({ engine: engine.value, voice: voice.value }); });
    mode.addEventListener('change', function(){ updateModeDescription(); updateSettings({ mode: mode.value }); });
    shortcut.addEventListener('change', function(){ updateSettings({ shortcut: shortcut.value }); });
    historyEnabled.addEventListener('change', function(){ writeStorage(HISTORY_ENABLED_KEY, historyEnabled.checked ? 'true' : 'false'); renderHistory(); });
    fileInput.addEventListener('change', function(){ readLocalTextFile(fileInput.files && fileInput.files[0]); });
    documentPanel.addEventListener('dragenter', function(event){
      if(isInteractionLocked()) return;
      if(!event.dataTransfer || !event.dataTransfer.types || !Array.from(event.dataTransfer.types).includes('Files')) return;
      event.preventDefault();
      dragDepth += 1;
      documentPanel.classList.add('is-dragging');
    });
    documentPanel.addEventListener('dragover', function(event){
      if(isInteractionLocked()) return;
      if(!event.dataTransfer || !event.dataTransfer.types || !Array.from(event.dataTransfer.types).includes('Files')) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    });
    documentPanel.addEventListener('dragleave', function(){
      dragDepth = Math.max(0, dragDepth - 1);
      if(!dragDepth) documentPanel.classList.remove('is-dragging');
    });
    documentPanel.addEventListener('drop', function(event){
      event.preventDefault();
      dragDepth = 0;
      documentPanel.classList.remove('is-dragging');
      if(isInteractionLocked()){
        setLocalStatus('Wait for the current reading action to finish before replacing the text.', true);
        return;
      }
      readLocalTextFile(event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0]);
    });
    text.addEventListener('input', function(){ resetClearUndo(); writeStorage(TEXT_KEY, text.value || ''); updateCounts(); });
    document.addEventListener('keydown', function(event){
      if((event.metaKey || event.ctrlKey) && event.key === 'Enter'){
        event.preventDefault();
        playOrPause();
      } else if(event.key === 'Escape' && currentStatus && currentStatus.running){
        event.preventDefault();
        withBusy(function(){ return post('/api/reader/control', { action: 'stop' }); });
      }
    });

    migrateLegacyStorage();
    text.value = readStorage(TEXT_KEY, '');
    historyEnabled.checked = readStorage(HISTORY_ENABLED_KEY, 'false') === 'true';
    resetClearUndo();
    updateCounts();
    if((text.value || '').length > MAX_TEXT_CHARACTERS) validateTextLength(text.value);
    syncEngineVoices(engine.value || 'kokoro', voice.value || 'af_heart');
    updateModeDescription();
    renderHistory();
    currentExportId = readStorage(EXPORT_KEY, '') || null;
    if(currentExportId){
      exportRunning = true;
      exportCancelButton.hidden = false;
      exportProgressTrack.hidden = false;
      exportStatus.textContent = 'Reconnecting to voice file export…';
      refreshExport();
    }
    runStatusPoll();
    runHealthPoll();
    refreshCache();
    document.addEventListener('visibilitychange', function(){
      if(document.hidden){
        if(statusTimer) clearTimeout(statusTimer);
        if(healthTimer) clearTimeout(healthTimer);
        statusTimer = null;
        healthTimer = null;
        return;
      }
      runStatusPoll();
      runHealthPoll();
      refreshCache();
      if(currentExportId && exportRunning) refreshExport();
    });
    window.addEventListener('beforeunload', function(){ clearTimeout(statusTimer); clearTimeout(healthTimer); if(clearUndoTimer) clearTimeout(clearUndoTimer); });
  })();
  </script>
</body>
</html>`;
}
