import { kokoroVoiceOptions } from './kokoro-tts.js';

function esc(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderPage(): string {
  const voiceCards = kokoroVoiceOptions().map((voice) => `
      <button class="voice-card${voice.id === 'af_heart' ? ' is-active' : ''}" type="button" data-voice="${esc(voice.id)}">
        <span class="voice-badge">${esc(voice.label.slice(0, 1))}</span>
        <span>
          <span class="voice-name">${esc(voice.label)}</span>
          <span class="voice-desc">${esc(voice.description)}</span>
        </span>
      </button>`).join('');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Kokoro Reader</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #101113;
      --panel: #191b1f;
      --panel-2: #202329;
      --line: #30343d;
      --text: #f4f1eb;
      --muted: #a8acb7;
      --soft: #7dd3c7;
      --soft-2: rgba(125, 211, 199, 0.16);
      --danger: #ff9f9f;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background: var(--bg);
      color: var(--text);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    main {
      width: min(1120px, calc(100vw - 32px));
      margin: 0 auto;
      padding: 28px 0;
      display: grid;
      gap: 18px;
    }
    header {
      display: flex;
      align-items: end;
      justify-content: space-between;
      gap: 16px;
    }
    h1 {
      margin: 0 0 5px;
      font-size: 26px;
      line-height: 1.1;
      font-weight: 800;
      letter-spacing: 0;
    }
    .sub {
      margin: 0;
      color: var(--muted);
      font-size: 14px;
      line-height: 1.5;
    }
    .status {
      min-width: 220px;
      text-align: right;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.45;
    }
    .app {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 330px;
      gap: 16px;
      align-items: stretch;
    }
    textarea {
      width: 100%;
      min-height: 560px;
      resize: vertical;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #15171b;
      color: var(--text);
      padding: 18px;
      font: 15px/1.62 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
      outline: none;
    }
    textarea:focus { border-color: var(--soft); box-shadow: 0 0 0 3px var(--soft-2); }
    aside {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
      padding: 14px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .section-title {
      margin: 0 0 8px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0;
    }
    .voice-grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 8px;
    }
    button {
      font: inherit;
    }
    .voice-card {
      width: 100%;
      min-height: 66px;
      display: grid;
      grid-template-columns: 34px 1fr;
      gap: 10px;
      align-items: center;
      text-align: left;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel-2);
      color: var(--text);
      padding: 10px;
      cursor: pointer;
    }
    .voice-card:hover { border-color: #4b515d; }
    .voice-card.is-active { border-color: var(--soft); box-shadow: inset 0 0 0 1px var(--soft); background: #1c2728; }
    .voice-badge {
      width: 32px;
      height: 32px;
      border-radius: 8px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: var(--soft);
      background: var(--soft-2);
      font-weight: 800;
      font-size: 12px;
    }
    .voice-name { display: block; font-weight: 800; font-size: 13px; line-height: 1.2; }
    .voice-desc { display: block; margin-top: 4px; color: var(--muted); font-size: 12px; line-height: 1.35; }
    .speed-row, .action-row {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 8px;
    }
    .speed-row button, .action-row button {
      min-height: 38px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel-2);
      color: var(--text);
      font-size: 13px;
      font-weight: 800;
      cursor: pointer;
    }
    .speed-row button.is-active {
      border-color: var(--soft);
      background: var(--soft-2);
      color: var(--soft);
    }
    .action-row {
      grid-template-columns: 1fr 1fr;
      margin-top: auto;
    }
    .play {
      border-color: var(--soft) !important;
      background: var(--soft) !important;
      color: #081312 !important;
    }
    .stop { color: var(--muted) !important; }
    .meta {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.4;
    }
    .error { color: var(--danger); }
    @media (max-width: 860px) {
      main { width: min(100vw - 24px, 680px); padding: 18px 0; }
      header { align-items: start; flex-direction: column; }
      .status { text-align: left; min-width: 0; }
      .app { grid-template-columns: 1fr; }
      textarea { min-height: 420px; }
    }
  </style>
</head>
<body>
  <main data-reader-app>
    <header>
      <div>
        <h1>Kokoro Reader</h1>
        <p class="sub">Paste text, choose a Kokoro voice, and play it locally.</p>
      </div>
      <div class="status" data-status>Ready.</div>
    </header>
    <div class="app">
      <textarea data-text placeholder="Paste the text you want Kokoro to read..."></textarea>
      <aside>
        <section>
          <p class="section-title">Voice</p>
          <div class="voice-grid">${voiceCards}
          </div>
        </section>
        <section>
          <p class="section-title">Speed</p>
          <div class="speed-row">
            <button type="button" data-rate="0.8">Slow</button>
            <button type="button" data-rate="1" class="is-active">Normal</button>
            <button type="button" data-rate="1.25">Fast</button>
          </div>
        </section>
        <div class="meta">
          <span data-count>0 chars</span>
          <span>Kokoro only</span>
        </div>
        <div class="action-row">
          <button class="play" type="button" data-play>Play</button>
          <button class="stop" type="button" data-stop>Stop</button>
        </div>
      </aside>
    </div>
  </main>
  <script>
  (function(){
    var text = document.querySelector('[data-text]');
    var status = document.querySelector('[data-status]');
    var count = document.querySelector('[data-count]');
    var voice = 'af_heart';
    var rate = 1;
    var audio = null;
    var ctrl = null;

    function setStatus(message, error){
      status.textContent = message;
      status.classList.toggle('error', !!error);
    }
    function updateCount(){
      count.textContent = String((text.value || '').length) + ' chars';
    }
    function selectVoice(next){
      voice = next || 'af_heart';
      localStorage.setItem('kokoro-reader-voice', voice);
      document.querySelectorAll('[data-voice]').forEach(function(button){
        button.classList.toggle('is-active', button.getAttribute('data-voice') === voice);
      });
    }
    function selectRate(next){
      rate = Number(next) || 1;
      localStorage.setItem('kokoro-reader-rate', String(rate));
      document.querySelectorAll('[data-rate]').forEach(function(button){
        button.classList.toggle('is-active', Number(button.getAttribute('data-rate')) === rate);
      });
    }
    function stopAudio(){
      if(ctrl){ try { ctrl.abort(); } catch(e) {} ctrl = null; }
      if(audio){ try { audio.pause(); audio.currentTime = 0; } catch(e) {} }
      audio = null;
      setStatus('Stopped.');
    }
    function readJsonOrError(response){
      if(response.ok) return response.json();
      return response.json().then(function(body){
        throw new Error((body && body.error) || 'Kokoro speech failed.');
      }, function(){
        throw new Error('Kokoro speech failed.');
      });
    }
    function playAudio(){
      var value = (text.value || '').trim();
      if(!value){ setStatus('Paste some text first.', true); return; }
      localStorage.setItem('kokoro-reader-text', text.value || '');
      stopAudio();
      ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      setStatus('Generating Kokoro speech...');
      fetch('/api/tts/kokoro', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: value, voice: voice, rate: rate }),
        signal: ctrl ? ctrl.signal : undefined
      })
        .then(readJsonOrError)
        .then(function(data){
          ctrl = null;
          audio = new Audio(data.url);
          audio.onended = function(){ setStatus(data.cached ? 'Finished. Cached audio used.' : 'Finished.'); };
          audio.onerror = function(){ setStatus('Audio could not play.', true); };
          setStatus(data.cached ? 'Playing cached audio...' : 'Playing...');
          var started = audio.play();
          if(started && started.catch){
            started.catch(function(){
              setStatus('Audio is ready. Press Play again if the browser blocked playback.');
            });
          }
        })
        .catch(function(error){
          if(error && error.name === 'AbortError') return;
          ctrl = null;
          setStatus(error && error.message ? error.message : 'Kokoro speech failed.', true);
        });
    }

    document.addEventListener('click', function(event){
      var voiceButton = event.target.closest && event.target.closest('[data-voice]');
      if(voiceButton){ selectVoice(voiceButton.getAttribute('data-voice')); return; }
      var rateButton = event.target.closest && event.target.closest('[data-rate]');
      if(rateButton){ selectRate(rateButton.getAttribute('data-rate')); return; }
      if(event.target.closest && event.target.closest('[data-play]')){ playAudio(); return; }
      if(event.target.closest && event.target.closest('[data-stop]')){ stopAudio(); return; }
    });
    text.addEventListener('input', function(){
      localStorage.setItem('kokoro-reader-text', text.value || '');
      updateCount();
    });

    text.value = localStorage.getItem('kokoro-reader-text') || '';
    selectVoice(localStorage.getItem('kokoro-reader-voice') || voice);
    selectRate(localStorage.getItem('kokoro-reader-rate') || rate);
    updateCount();
  })();
  </script>
</body>
</html>`;
}
