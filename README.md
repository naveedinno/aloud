# Kokoro Reader

A tiny local Mac reader for selected text and pasted text, powered by Kokoro AI.

## Setup

Install the Node dependencies:

```bash
npm install
```

Install Kokoro Reader's local Python speech environment:

```bash
npm run setup:kokoro
```

This creates its Python environment under:

```text
~/Library/Application Support/Kokoro Reader/kokoro-venv
```

## Run

```bash
npm run dev
```

Then open `http://localhost:7878/`.

The reader page and menu-bar helper share one local playback session. Voice, speed, playback mode, pause/resume, Stop, and exact chunk progress stay in sync across both surfaces. The page also includes:

- compact voice selection with a preview
- Auto, Fast Start, and Smooth Playback modes
- previous, replay, and next chunk controls
- a Mac setup health panel with repair actions
- an optional five-item local reading history, disabled by default

Use **Command+Enter** to read or pause and **Escape** to stop while the reader page is focused.

## Read selected text anywhere on macOS

Install the system Service:

```bash
npm run install:macos-service
```

Then select text in a Mac app, right-click, and choose **Services > Read Aloud with Kokoro**. In some apps it appears under **Quick Actions** instead of **Services**.

The installer also adds:

- **Kokoro Speaker - Heart/Bella/Nicole/Sarah/Adam/Onyx/Emma/Daniel**
- **Kokoro Style - Slow/Normal/Fast**
- **Stop Kokoro Reader**

When a Service starts, Kokoro Reader uses the menu bar item for status, speed, reader choice, and Stop Reading. Long selections use adaptive chunks: a smaller first chunk reduces startup time, later sentences are grouped to reduce playback seams, and future audio is prepared while the current chunk plays.

The installer also adds a lightweight local LaunchAgent named `local.kokoro-reader.daemon`. The daemon starts with no model in memory, lazily loads one shared Kokoro model when needed, reuses it for American and British voices, and unloads it 20 seconds after generation becomes idle. This keeps normal idle RAM low while still accelerating quick follow-up reads. The first uncached read after the model unloads may take a little longer to start. Kokoro Reader stores its cache, controller helper, and managed Python environment in `~/Library/Application Support/Kokoro Reader`.

It also adds `local.kokoro-reader.menubar`, a small icon-only menu bar item with Read Clipboard, Stop Reading, reader choices, speed choices, Open Reader, and Install Services. Choosing a reader there sets the default voice used by **Read Aloud with Kokoro**.

The global read-selection shortcut defaults to **Option+R**. Change it from the reader page's **Mac setup** panel; the menu-bar helper picks up the new shortcut automatically.

## Build The Mac App

Create a distributable app bundle:

```bash
npm run build:macos-app
```

This writes:

```text
build/Kokoro Reader.app
build/Kokoro Reader.zip
```

Create a shareable DMG:

```bash
npm run build:macos-dmg
```

This writes:

```text
build/Kokoro Reader.dmg
```

The app bundle includes the Node.js runtime used to launch Kokoro Reader. First-time Kokoro setup still needs Homebrew, Python, and network access to install the local speech environment.

Opening the app lets you choose **Open Reader**, **Install Services**, or **Setup Kokoro**. Installing Services also starts the menu bar item.

You can also test the command directly:

```bash
echo "Read this with Kokoro" | npm run start -- speak --stdin --no-open
```

Advanced tuning:

```bash
echo "Read this with Kokoro" | npm run start -- speak --stdin --no-open --workers 1 --prefetch 3
echo "Read this with Kokoro" | node dist/cli.js speak --stdin --controller --daemon
```

## Test

```bash
npm test
```
