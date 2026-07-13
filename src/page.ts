import { kokoroVoiceOptions } from './kokoro-tts.js';
import { GLOBAL_SHORTCUTS } from './preferences.js';

function esc(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderPage(): string {
  const voices = kokoroVoiceOptions();
  const voiceOptions = [
    '<option value="random" data-description="Choose a different voice for every reading.">Random voice</option>',
    ...voices.map((voice) => `<option value="${esc(voice.id)}" data-description="${esc(voice.description)}">${esc(voice.label)}</option>`),
  ].join('');
  const shortcutOptions = GLOBAL_SHORTCUTS
    .map((shortcut) => `<option value="${esc(shortcut.id)}">${esc(shortcut.label)}</option>`)
    .join('');

  return String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Kokoro Reader</title>
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
    .connection.is-busy .connection-dot { background: var(--warning); box-shadow: 0 0 0 4px rgba(233, 201, 141, 0.1); }
    .connection.is-error .connection-dot, .health-item.needs-action .health-dot { background: var(--danger); }
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
    .now-reading {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 12px;
      align-items: start;
      padding: 13px 16px;
      border-bottom: 1px solid var(--line);
      background: var(--soft-2);
    }
    .now-reading[hidden] { display: none; }
    .now-label {
      margin-top: 2px;
      color: var(--soft-strong);
      font-size: 10px;
      font-weight: 850;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .chunk-text {
      margin: 0;
      color: var(--text);
      font: 450 15px/1.55 "Kokoro Atkinson", ui-sans-serif, system-ui, sans-serif;
      display: -webkit-box;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 3;
      overflow: hidden;
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
      .connection span:last-child { display: none; }
      .config-bar { grid-template-columns: 1fr; padding: 13px; }
      .speed-field { grid-column: auto; }
      .transport { position: sticky; top: 0; z-index: 3; grid-template-columns: 1fr; gap: 10px; padding: 12px 13px; }
      .transport-actions { display: grid; grid-template-columns: 1fr auto; }
      .primary-button { width: 100%; }
      .chunk-actions { justify-content: space-between; }
      .transport-status { grid-column: auto; grid-row: auto; }
      .editor-head { align-items: flex-start; padding: 12px 13px 9px; }
      .editor-actions { gap: 6px; }
      textarea { width: calc(100% - 26px); min-height: 330px; margin: 0 13px 13px; padding: 17px; font-size: 17px; }
      .now-reading { grid-template-columns: 1fr; gap: 5px; padding: 12px 13px; }
      .health-grid { grid-template-columns: 1fr; }
      .shortcut-row, .privacy-row { align-items: flex-start; flex-direction: column; }
      .shortcut-row select { width: 100%; }
    }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { scroll-behavior: auto !important; transition: none !important; }
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
      border: 1px solid #3a4e4b;
      border-radius: 11px;
      color: #10201d;
      background: var(--mint);
      font-size: 18px;
      font-weight: 800;
      letter-spacing: -0.04em;
    }
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
    .connection-dot { width: 7px; height: 7px; background: var(--mint); box-shadow: none; }

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
    .document-body { position: relative; }
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
    }
    textarea::placeholder { color: #6f7775; }
    textarea:focus { outline: 0; box-shadow: inset 3px 0 0 var(--mint); }

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
    select:hover, select:focus { border-color: #52726d; background-color: #1b211f; box-shadow: none; outline: none; }
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

    details summary {
      min-height: 52px;
      padding: 0 15px;
      color: #d8dcda;
      font-size: 12px;
      font-weight: 700;
    }
    details summary:hover { background: #171b1b; }
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
    .shortcut-row, .privacy-row { gap: 10px; padding-top: 12px; }
    .shortcut-row { align-items: flex-start; flex-direction: column; }
    .shortcut-row select { width: 100%; }
    .privacy-toggle { color: #bdc5c3; font-size: 10px; }
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
    }
    .now-reading {
      grid-column: 1 / -1;
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      gap: 12px;
      align-items: center;
      margin: -2px -2px 0;
      padding: 9px 12px;
      border: 1px solid #30413e;
      border-radius: 10px;
      background: #17211f;
    }
    .now-label { color: var(--mint); font-size: 9px; font-weight: 800; letter-spacing: 0.14em; text-transform: uppercase; }
    .chunk-text { overflow: hidden; margin: 0; color: #d8dedc; font: 450 13px/1.45 "Kokoro Atkinson", ui-sans-serif, system-ui, sans-serif; white-space: nowrap; text-overflow: ellipsis; }
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
    .primary-button:hover { background: var(--mint-bright); transform: none; box-shadow: none; }
    .stop-button { height: 46px; border-radius: 10px; padding: 0 14px; }
    .transport-status { min-width: 0; }
    .status-line { margin-bottom: 7px; color: var(--muted); font-size: 11px; }
    .status-message { overflow: hidden; color: #d6dcda; white-space: nowrap; text-overflow: ellipsis; }
    .status-message.error { color: #efaaaa; }
    .progress-track { height: 4px; background: #29302f; }
    .progress-bar { background: var(--mint); }
    .chunk-actions { display: flex; gap: 6px; }
    .icon-button { width: 38px; height: 38px; border-radius: 9px; font-size: 17px; }

    @media (max-width: 940px) {
      .app-shell { width: min(100% - 28px, 760px); padding-top: 18px; }
      .workspace { grid-template-columns: 1fr; }
      .control-rail { position: static; grid-template-columns: 1fr 1fr; }
      .control-card { grid-row: span 2; }
      textarea { min-height: 62vh; }
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
      .document-title { display: block; }
      .document-title h2 { font-size: 11px; }
      .editor-meta { max-width: 180px; margin-top: 2px; font-size: 10px; }
      textarea { min-height: 56vh; padding: 28px 23px 80px; font-size: 18px; line-height: 1.7; }
      .control-rail { grid-template-columns: 1fr; }
      .control-card { grid-row: auto; }
      .player-shell { grid-template-columns: 1fr auto; gap: 10px; bottom: 8px; margin-top: 10px; border-radius: 13px; padding: 9px; }
      .transport-actions { grid-column: 1 / -1; display: grid; grid-template-columns: 1fr auto; }
      .primary-button { width: 100%; }
      .transport-status { grid-column: 1 / -1; grid-row: 2; }
      .chunk-actions { grid-column: 1 / -1; justify-content: flex-end; }
      .now-reading { grid-template-columns: 1fr; gap: 3px; }
      .chunk-text { white-space: normal; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
    }
  </style>
</head>
<body>
  <main class="app-shell" data-reader-app data-listening-desk>
    <header class="app-header">
      <div class="brand">
        <span class="brand-mark" aria-hidden="true">K</span>
        <div>
          <h1>Kokoro Reader</h1>
          <p class="sub">A private listening desk on your Mac.</p>
        </div>
      </div>
      <div class="connection" data-connection aria-live="polite">
        <span class="connection-dot" aria-hidden="true"></span>
        <span data-connection-label>Connecting</span>
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
            <button class="utility-button" type="button" data-paste>Paste</button>
            <button class="utility-button" type="button" data-clear>Clear</button>
          </div>
        </div>
        <div class="document-body">
          <label class="sr-only" for="reader-text">Text to read</label>
          <textarea id="reader-text" data-text placeholder="Paste or type something worth listening to…" spellcheck="true"></textarea>
        </div>
      </section>

      <aside class="control-rail" aria-label="Reading controls">
        <section class="control-card">
          <div class="control-heading">
            <span class="eyebrow">Listening setup</span>
            <h2>Voice &amp; pacing</h2>
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
        </section>

        <details data-setup>
          <summary>
            <span class="summary-copy">Mac connection <span class="summary-badge" data-health-summary>Checking</span></span>
            <span aria-hidden="true">⌄</span>
          </summary>
          <div class="details-body">
            <div class="health-grid" data-health-grid>
              <div class="health-item" data-health="kokoro"><span class="health-dot"></span><div><span class="health-name">Kokoro</span><span class="health-detail">Checking local environment…</span></div><button class="repair-button" type="button" data-repair="kokoro">Set up</button></div>
              <div class="health-item" data-health="daemon"><span class="health-dot"></span><div><span class="health-name">Shared reader</span><span class="health-detail">Checking daemon…</span></div></div>
              <div class="health-item" data-health="services"><span class="health-dot"></span><div><span class="health-name">Services</span><span class="health-detail">Checking macOS Services…</span></div><button class="repair-button" type="button" data-repair="services">Install</button></div>
              <div class="health-item" data-health="menuBar"><span class="health-dot"></span><div><span class="health-name">Menu bar</span><span class="health-detail">Checking helper…</span></div><button class="repair-button" type="button" data-repair="services">Install</button></div>
              <div class="health-item" data-health="accessibility"><span class="health-dot"></span><div><span class="health-name">Accessibility</span><span class="health-detail">Checking selection access…</span></div><button class="repair-button" type="button" data-repair="accessibility">Open settings</button></div>
            </div>
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
            <div class="recent-list" data-recent-list></div>
            <div class="history-footer"><button class="utility-button" type="button" data-clear-history>Clear history</button></div>
          </div>
        </details>
      </aside>
    </div>

    <section class="player-shell" aria-label="Playback">
      <div class="now-reading" data-now-reading hidden>
        <span class="now-label">Listening now</span>
        <p class="chunk-text" data-chunk-text></p>
      </div>
      <div class="transport-actions">
        <button class="primary-button" type="button" data-play aria-keyshortcuts="Control+Enter Meta+Enter">Read aloud</button>
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
      <div class="chunk-actions" aria-label="Chunk navigation">
        <button class="icon-button" type="button" data-seek="previous" aria-label="Previous chunk" title="Previous chunk" disabled>‹</button>
        <button class="icon-button" type="button" data-seek="replay" aria-label="Replay chunk" title="Replay chunk" disabled>↺</button>
        <button class="icon-button" type="button" data-seek="next" aria-label="Next chunk" title="Next chunk" disabled>›</button>
      </div>
    </section>
  </main>

  <script>
  (function(){
    var text = document.querySelector('[data-text]');
    var count = document.querySelector('[data-count]');
    var status = document.querySelector('[data-status]');
    var play = document.querySelector('[data-play]');
    var stop = document.querySelector('[data-stop]');
    var voice = document.querySelector('[data-voice]');
    var mode = document.querySelector('[data-mode]');
    var shortcut = document.querySelector('[data-shortcut]');
    var preview = document.querySelector('[data-preview]');
    var connection = document.querySelector('[data-connection]');
    var connectionLabel = document.querySelector('[data-connection-label]');
    var progress = document.querySelector('[data-progress]');
    var progressTrack = document.querySelector('[data-progress-track]');
    var progressLabel = document.querySelector('[data-progress-label]');
    var nowReading = document.querySelector('[data-now-reading]');
    var chunkText = document.querySelector('[data-chunk-text]');
    var historyEnabled = document.querySelector('[data-history-enabled]');
    var recentList = document.querySelector('[data-recent-list]');
    var currentStatus = null;
    var requestBusy = false;
    var statusTimer = null;
    var healthTimer = null;
    var TEXT_KEY = 'kokoro-reader-text';
    var HISTORY_KEY = 'kokoro-reader-history';
    var HISTORY_ENABLED_KEY = 'kokoro-reader-history-enabled';

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
          if(!response.ok) throw new Error(body.error || 'Kokoro Reader request failed.');
          return body;
        });
      });
    }

    function post(path, body){
      return requestJson(path, { method: 'POST', body: body });
    }

    function setStatus(message, error){
      status.textContent = message || 'Ready to read.';
      status.classList.toggle('is-error', !!error);
    }

    function updateCounts(){
      var value = text.value || '';
      var words = value.trim() ? value.trim().split(/\s+/).length : 0;
      var paragraphs = value.trim() ? value.trim().split(/\n\s*\n+/).length : 0;
      count.textContent = String(words) + (words === 1 ? ' word' : ' words') + ' · ' + String(paragraphs) + (paragraphs === 1 ? ' paragraph' : ' paragraphs') + ' · ' + String(value.length) + (value.length === 1 ? ' character' : ' characters');
      if(!currentStatus || !currentStatus.running) play.disabled = !value.trim() || requestBusy;
    }

    function selectedDescription(select){
      var option = select.options[select.selectedIndex];
      return option ? option.getAttribute('data-description') || '' : '';
    }

    function updateVoiceDescription(){
      document.querySelector('[data-voice-description]').textContent = selectedDescription(voice);
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
      connection.classList.remove('is-ready', 'is-busy', 'is-error');
      connection.classList.add(next.running ? 'is-busy' : 'is-ready');
      connectionLabel.textContent = next.running ? (next.paused ? 'Paused' : 'Reading') : 'Local · Ready';
      connection.setAttribute('aria-label', 'Reader status: ' + connectionLabel.textContent);
      voice.value = next.voice || 'af_heart';
      mode.value = next.mode || 'auto';
      shortcut.value = next.shortcut || 'option+r';
      updateVoiceDescription();
      updateModeDescription();
      document.querySelectorAll('[data-rate]').forEach(function(button){
        button.setAttribute('aria-pressed', Math.abs(Number(button.getAttribute('data-rate')) - Number(next.rate || 1)) < 0.02 ? 'true' : 'false');
      });

      var state = next.state || {};
      // A daemon can retain its last error after it has gone idle. Do not leave
      // an old failure pinned beside a ready reader, but keep active failures
      // visible long enough to explain what just happened.
      var staleIdleError = state.status === 'error' && !next.running && !wasRunning;
      setStatus(
        staleIdleError ? 'Ready to read.' : (next.paused ? 'Paused.' : state.message || (next.running ? 'Reading…' : 'Ready to read.')),
        state.status === 'error' && !staleIdleError,
      );
      play.textContent = next.running ? (next.paused ? 'Resume' : 'Pause') : 'Read aloud';
      play.disabled = requestBusy || (!next.running && !(text.value || '').trim());
      stop.disabled = requestBusy || !next.running;
      preview.disabled = requestBusy || next.running;
      document.querySelector('[data-seek="previous"]').disabled = requestBusy || !next.canGoPrevious;
      document.querySelector('[data-seek="replay"]').disabled = requestBusy || !next.canReplay;
      document.querySelector('[data-seek="next"]').disabled = requestBusy || !next.canGoNext;

      var total = Number(state.total || 0);
      var current = Number(state.current || 0);
      var percent = total > 0 ? Math.max(0, Math.min(100, Math.round((current / total) * 100))) : 0;
      progress.style.width = String(percent) + '%';
      progressTrack.setAttribute('aria-valuenow', String(percent));
      progressLabel.textContent = total > 1 ? String(Math.max(1, current)) + ' / ' + String(total) : (next.running ? next.voiceLabel + ' · ' + next.rate + '×' : '—');

      var exactChunk = String(state.chunkText || '').trim();
      nowReading.hidden = !exactChunk || (!next.running && state.status !== 'done');
      chunkText.textContent = exactChunk;
    }

    function markOffline(error){
      connection.classList.remove('is-ready', 'is-busy');
      connection.classList.add('is-error');
      connectionLabel.textContent = 'Reader unavailable';
      connection.setAttribute('aria-label', 'Reader status: unavailable');
      setStatus(error && error.message ? error.message : 'Could not reach the local reader.', true);
    }

    function refreshStatus(){
      return requestJson('/api/reader/status').then(renderStatus).catch(markOffline);
    }

    function withBusy(operation){
      if(requestBusy) return Promise.resolve();
      requestBusy = true;
      play.disabled = true;
      preview.disabled = true;
      return Promise.resolve().then(operation).then(function(next){
        if(next && next.ok) renderStatus(next);
        return next;
      }).catch(function(error){
        setStatus(error.message || 'Kokoro Reader request failed.', true);
      }).finally(function(){
        requestBusy = false;
        updateCounts();
        refreshStatus();
      });
    }

    function updateSettings(settings){
      return withBusy(function(){ return post('/api/reader/settings', settings); });
    }

    function playOrPause(){
      if(currentStatus && currentStatus.running){
        return withBusy(function(){ return post('/api/reader/control', { action: currentStatus.paused ? 'resume' : 'pause' }); });
      }
      var value = (text.value || '').trim();
      if(!value){ setStatus('Paste or type some text first.', true); return; }
      saveRecent(value);
      return withBusy(function(){
        setStatus('Preparing text…');
        return post('/api/reader/speak', {
          mode: mode.value,
          rate: selectedRate(),
          text: value,
          voice: voice.value
        });
      });
    }

    function selectedRate(){
      var selected = document.querySelector('[data-rate][aria-pressed="true"]');
      return selected ? Number(selected.getAttribute('data-rate')) : 1;
    }

    function previewVoice(){
      var option = voice.options[voice.selectedIndex];
      var label = option ? option.textContent : 'Kokoro';
      return withBusy(function(){
        setStatus('Preparing voice preview…');
        return post('/api/reader/speak', {
          mode: 'smooth',
          rate: selectedRate(),
          text: label + ' is ready to read with Kokoro.',
          voice: voice.value
        });
      });
    }

    function loadHistory(){
      try {
        var value = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
        return Array.isArray(value) ? value.filter(function(item){ return item && typeof item.text === 'string'; }).slice(0, 5) : [];
      } catch(e) { return []; }
    }

    function saveRecent(value){
      if(!historyEnabled.checked) return;
      var items = loadHistory().filter(function(item){ return item.text !== value; });
      items.unshift({ text: value, savedAt: Date.now() });
      localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, 5)));
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
        return;
      }
      items.forEach(function(item, index){
        var row = document.createElement('div');
        row.className = 'recent-item';
        var copy = document.createElement('div');
        var title = document.createElement('div');
        title.className = 'recent-title';
        title.textContent = historyTitle(item.text);
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
        row.appendChild(copy);
        row.appendChild(restore);
        recentList.appendChild(row);
      });
    }

    function renderHealth(health){
      var names = ['kokoro', 'daemon', 'services', 'menuBar', 'accessibility'];
      var ready = 0;
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
      if(health.repair && health.repair.message) setStatus(health.repair.message, !health.repair.running && /failed/i.test(health.repair.message));
      document.querySelectorAll('[data-repair]').forEach(function(button){
        button.disabled = !!(health.repair && health.repair.running);
      });
    }

    function refreshHealth(){
      return requestJson('/api/system/health').then(renderHealth).catch(function(){});
    }

    document.addEventListener('click', function(event){
      var target = event.target;
      if(target.closest('[data-play]')){ playOrPause(); return; }
      if(target.closest('[data-stop]')){ withBusy(function(){ return post('/api/reader/control', { action: 'stop' }); }); return; }
      if(target.closest('[data-preview]')){ previewVoice(); return; }
      var rateButton = target.closest('[data-rate]');
      if(rateButton){
        document.querySelectorAll('[data-rate]').forEach(function(button){ button.setAttribute('aria-pressed', button === rateButton ? 'true' : 'false'); });
        updateSettings({ rate: Number(rateButton.getAttribute('data-rate')) });
        return;
      }
      var seek = target.closest('[data-seek]');
      if(seek){ withBusy(function(){ return post('/api/reader/seek', { action: seek.getAttribute('data-seek') }); }); return; }
      if(target.closest('[data-clear]')){
        text.value = '';
        localStorage.removeItem(TEXT_KEY);
        updateCounts();
        text.focus();
        return;
      }
      if(target.closest('[data-paste]')){
        if(!navigator.clipboard || !navigator.clipboard.readText){ setStatus('Clipboard access is unavailable in this browser.', true); return; }
        navigator.clipboard.readText().then(function(value){ text.value = value; localStorage.setItem(TEXT_KEY, value); updateCounts(); text.focus(); }).catch(function(){ setStatus('Allow clipboard access, then try Paste again.', true); });
        return;
      }
      var repair = target.closest('[data-repair]');
      if(repair){
        withBusy(function(){ return post('/api/system/repair', { action: repair.getAttribute('data-repair') }); }).then(refreshHealth);
        return;
      }
      var restore = target.closest('[data-restore]');
      if(restore){
        var item = loadHistory()[Number(restore.getAttribute('data-restore'))];
        if(item){ text.value = item.text; localStorage.setItem(TEXT_KEY, item.text); updateCounts(); text.focus(); }
        return;
      }
      if(target.closest('[data-clear-history]')){ localStorage.removeItem(HISTORY_KEY); renderHistory(); }
    });

    voice.addEventListener('change', function(){ updateVoiceDescription(); updateSettings({ voice: voice.value }); });
    mode.addEventListener('change', function(){ updateModeDescription(); updateSettings({ mode: mode.value }); });
    shortcut.addEventListener('change', function(){ updateSettings({ shortcut: shortcut.value }); });
    historyEnabled.addEventListener('change', function(){ localStorage.setItem(HISTORY_ENABLED_KEY, historyEnabled.checked ? 'true' : 'false'); renderHistory(); });
    text.addEventListener('input', function(){ localStorage.setItem(TEXT_KEY, text.value || ''); updateCounts(); });
    document.addEventListener('keydown', function(event){
      if((event.metaKey || event.ctrlKey) && event.key === 'Enter'){
        event.preventDefault();
        playOrPause();
      } else if(event.key === 'Escape' && currentStatus && currentStatus.running){
        event.preventDefault();
        withBusy(function(){ return post('/api/reader/control', { action: 'stop' }); });
      }
    });

    text.value = localStorage.getItem(TEXT_KEY) || '';
    historyEnabled.checked = localStorage.getItem(HISTORY_ENABLED_KEY) === 'true';
    updateCounts();
    updateVoiceDescription();
    updateModeDescription();
    renderHistory();
    refreshStatus();
    refreshHealth();
    statusTimer = setInterval(refreshStatus, 900);
    healthTimer = setInterval(refreshHealth, 6000);
    window.addEventListener('beforeunload', function(){ clearInterval(statusTimer); clearInterval(healthTimer); });
  })();
  </script>
</body>
</html>`;
}
