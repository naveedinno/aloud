# macOS Selected Text Read Aloud Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a system-wide macOS selected-text read-aloud action backed by the local Aloud.

**Architecture:** Keep synthesis in `src/kokoro-tts.ts`, add playback orchestration in a new focused module, expose it through `src/cli.ts`, and create a macOS Automator Quick Action installer under `scripts/`.

**Tech Stack:** TypeScript, Node.js 20, Node test runner, macOS Automator workflow, `/usr/bin/afplay`.

---

### Task 1: CLI Speech Core

**Files:**
- Create: `src/speak.ts`
- Modify: `src/cli.ts`
- Test: `test/speak.test.mjs`

- [ ] Write failing tests for parsing `speak --stdin`, rejecting empty text, and invoking the injected player after synthesis.
- [ ] Run `npm test` and confirm the new tests fail because `dist/speak.js` does not exist.
- [ ] Implement `speakText`, stdin reading, and CLI dispatch.
- [ ] Run `npm test` and confirm all tests pass.

### Task 2: macOS Service Installer

**Files:**
- Create: `scripts/install-macos-service.sh`
- Modify: `README.md`
- Test: `test/macos-service-script.test.mjs`

- [ ] Write failing tests that assert the installer contains the expected workflow path, selected-text input mode, CLI command, and LaunchServices refresh.
- [ ] Run `npm test` and confirm the installer test fails because the script does not exist.
- [ ] Implement the installer with an Automator `workflow` bundle in `~/Library/Services`.
- [ ] Document install and usage.
- [ ] Run `npm test` and confirm all tests pass.

### Task 3: Local Install

**Files:**
- Execute: `scripts/install-macos-service.sh`

- [ ] Run `npm test`.
- [ ] Run `bash scripts/install-macos-service.sh`.
- [ ] Confirm the workflow exists at `~/Library/Services/Read Selection Aloud.workflow`.
- [ ] Report how to use it from right-click Services or Quick Actions.
