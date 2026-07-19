# macOS Selected Text Read Aloud Design

## Goal

Let the user select text anywhere on macOS, invoke a contextual Service or Quick Action, and hear the selection read aloud through the local Kokoro setup already used by Aloud.

## Approach

Use the existing Kokoro synthesis module as the source of truth. Add a non-browser CLI mode that accepts selected text through stdin, synthesizes a cached WAV file, and plays it with macOS `afplay`. Add an installer script that creates a macOS Automator Quick Action in `~/Library/Services` and registers it with LaunchServices.

## Scope

- Add `aloud speak` support through `src/cli.ts`.
- Add a reusable `speakText` function that can be tested without generating real speech or audio playback.
- Add a `scripts/install-macos-service.sh` installer for a "Read Selection Aloud" Quick Action.
- Document installation and right-click usage in `README.md`.

## Behavior

- The Quick Action receives selected text from macOS and pipes it into `npm run start -- speak --stdin --no-open`.
- The CLI trims and normalizes text through the existing Kokoro path.
- Empty selections fail with a clear error.
- The default voice is `af_heart`; users may pass `--voice` and `--rate` to the CLI.
- Generated audio is cached under the existing Kokoro cache directory.
- Playback uses `/usr/bin/afplay` on macOS.

## Non-Goals

- No native menu extension or privileged background daemon.
- No global keyboard shortcut assignment, though macOS can assign one to the installed Service later.
- No browser UI changes.

## Verification

- Unit tests cover stdin argument parsing, empty text validation, and player invocation.
- `npm test` must pass.
- The installer must create `~/Library/Services/Read Selection Aloud.workflow`.
