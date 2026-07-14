# Kokoro Reader

A tiny local Mac reader for selected text and pasted text, powered by Kokoro AI.

## Setup

Install the Node dependencies:

```bash
npm ci
```

Install Kokoro Reader's local Python speech environment:

```bash
npm run setup:kokoro
```

This creates its Python environment under:

```text
~/Library/Application Support/Kokoro Reader/kokoro-venv
```

Setup uses Python 3.12 and the exact dependency versions in `requirements-kokoro-py312.lock.txt`. It explicitly enables network access for setup and downloads `hexgrad/Kokoro-82M` at commit `f3ff3571791e39611d31c381e3a41a3af07b4987` into Kokoro Reader's private Hugging Face cache. Normal app and Service launches use that verified model offline so a later upstream model change cannot silently alter an installed reader.

## Run

```bash
npm run dev
```

Then open `http://localhost:7878/`.

The reader page and menu-bar helper share one local playback session. Voice, speed, playback mode, pause/resume, Stop, and exact chunk progress stay in sync across both surfaces. The page also includes:

- a document-first reading view that follows the exact active source chunk without estimating word timing
- local plain-text and Markdown file opening, including drag and drop
- an undoable Clear action so an accidental click does not discard the current draft
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

The installer first copies a versioned runtime and the app's bundled Node.js into `~/Library/Application Support/Kokoro Reader/runtime`, then points every Service and LaunchAgent at the stable `runtime/current` link. A content identity refreshes a rebuilt payload even when its semantic version did not change. During upgrades it stops only a listener verified as a Kokoro Reader daemon, then restarts the managed LaunchAgent; it refuses to signal an unrelated process on the same port. Installing from a DMG or an App Translocation path therefore never leaves a temporary `/Volumes/...` path in a workflow. Daemon and menu-bar logs are private to the user under `~/Library/Application Support/Kokoro Reader/logs`.

It also adds `local.kokoro-reader.menubar`, a small icon-only menu bar item with Read Clipboard, Stop Reading, reader choices, speed choices, Open Reader, and Install Services. Choosing a reader there sets the default voice used by **Read Aloud with Kokoro**.

The global read-selection shortcut defaults to **Option+R**. Change it from the reader page's **Mac setup** panel; the menu-bar helper picks up the new shortcut automatically.

Remove every Kokoro Reader-owned Service, LaunchAgent, helper, cache, preference, model, Python environment, and installed runtime with:

```bash
npm run uninstall:macos-service
```

The uninstaller removes only explicitly named Kokoro Reader paths and does not use broad process matching such as `pkill` or `killall`.

## Build The Mac App

Create a distributable app bundle:

```bash
npm run build:macos-app
```

This writes:

```text
build/Kokoro Reader.app
build/Kokoro Reader-<version>-macos-<architecture>.zip
```

Create a shareable DMG:

```bash
npm run build:macos-dmg
```

This writes:

```text
build/Kokoro Reader-<version>-macos-<architecture>.dmg
```

The app bundle includes the Node.js runtime used to launch Kokoro Reader, that runtime's complete upstream license/notices, and a precompiled menu-bar helper. Builds are deliberately labeled `arm64` or `x86_64`: the builder validates that the selected Node binary contains the build Mac's architecture, depends only on portable macOS system libraries under `/System/Library` or `/usr/lib`, and that the native helper matches the target. This rejects Homebrew binaries that would otherwise retain missing package-manager dylib paths on a clean Mac. Produce each architecture artifact on a matching Mac. `NODE_SOURCE=/path/to/node` selects a specific Node distribution; if its adjacent upstream `LICENSE` cannot be discovered, also pass `NODE_LICENSE_FILE=/path/to/node-distribution/LICENSE`. The version comes directly from `package.json`, and generated JavaScript plus stale app/ZIP/DMG staging artifacts are cleaned before packaging.

First-time Kokoro setup still needs Homebrew and network access. The setup script installs Homebrew's Python 3.12 and `espeak-ng` when needed, then installs the locked Python environment and pinned model.

Opening the app lets you choose **Open Reader**, **Install Services**, or **Setup Kokoro**. Installing Services also starts the menu bar item.

### Signing and notarization

Without release credentials, `npm run build:macos-dmg` creates an ad-hoc signed local/test build. The build still runs `codesign --verify --deep --strict` for the app and `hdiutil verify` for the DMG automatically.

For distribution, first store App Store Connect credentials in the login keychain (never in the repository):

```bash
xcrun notarytool store-credentials kokoro-reader-notary \
  --apple-id "you@example.com" \
  --team-id "TEAMID" \
  --password "app-specific-password"
```

Then build with a Developer ID Application certificate and the keychain profile:

```bash
MACOS_SIGN_IDENTITY="Developer ID Application: Name (TEAMID)" \
MACOS_NOTARY_PROFILE="kokoro-reader-notary" \
npm run build:macos-dmg
```

The release path signs the bundled Node and native helper inside-out, enables the hardened runtime and secure timestamps, notarizes and staples the app before recreating its ZIP, then signs, notarizes, and staples the DMG. It validates both tickets, runs Gatekeeper assessments, and repeats signature and disk-image verification. `MACOS_NOTARY_PROFILE` is rejected when `MACOS_SIGN_IDENTITY` is missing.

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
npm run test:packaging
```

The packaging test builds in a clean fixture, installs into a fresh fake home, confirms that generated workflows contain only the stable private runtime path, and verifies that uninstall leaves unrelated Services, LaunchAgents, and Application Support files untouched.
