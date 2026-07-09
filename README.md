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

When a Service starts, Kokoro Reader uses the menu bar item for status, speed, reader choice, and Stop Reading. Long selections are read in natural chunks: the first chunk starts as soon as it is ready, then Kokoro prepares future chunks in parallel so playback has fewer pauses.

The installer also adds a local LaunchAgent named `local.kokoro-reader.daemon`. It keeps the Kokoro worker pool warm between right-click reads, so the Service does not need to cold-start Python and load the model every time. Kokoro Reader stores its cache, controller helper, and managed Python environment in `~/Library/Application Support/Kokoro Reader`.

It also adds `local.kokoro-reader.menubar`, a small icon-only menu bar item with Read Clipboard, Stop Reading, reader choices, speed choices, Open Reader, and Install Services. Choosing a reader there sets the default voice used by **Read Aloud with Kokoro**.

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
echo "Read this with Kokoro" | npm run start -- speak --stdin --no-open --workers 3 --prefetch 3
echo "Read this with Kokoro" | node dist/cli.js speak --stdin --controller --daemon
```

## Test

```bash
npm test
```
