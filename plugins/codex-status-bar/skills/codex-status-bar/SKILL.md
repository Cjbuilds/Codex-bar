---
name: codex-status-bar
description: Use when setting up, testing, or troubleshooting the Codex Status Bar plugin and native menu bar app.
---

# Codex Status Bar

Help the user install, verify, or troubleshoot Codex Status Bar.

Important properties:

- It is macOS-first.
- It uses Codex lifecycle hooks and writes `~/.codex/statusbar/state.json`.
- It launches `Codex Status Bar.app` from the user's local statusbar directory.
- It does not patch `Codex.app`.
- It does not read Codex SQLite logs or conversation transcripts.
- It should not store prompt text, assistant output, command output, tool output, API keys, tokens, cookies, or passwords.

Useful commands from the repo root:

```bash
npm run test
npm run test:swift
npm run build:app
npm run verify
```

If the app does not appear, check:

```bash
ls -la ~/.codex/statusbar
open -gj "$HOME/.codex/statusbar/Codex Status Bar.app"
```
