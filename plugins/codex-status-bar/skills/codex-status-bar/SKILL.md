---
name: codex-status-bar
description: Use when setting up, testing, or troubleshooting the Codex Bar plugin and native menu bar app.
---

# Codex Bar

Help the user install, verify, or troubleshoot Codex Bar.

Important properties:

- It is macOS-first.
- It uses a local collector plus Codex lifecycle hooks and writes `~/.codex/statusbar/state.json`.
- It launches `Codex Bar.app` from the user's local statusbar directory.
- It does not patch `Codex.app`.
- It reads Codex metadata/goals and structured `update_plan` arguments, but it must not persist raw transcripts or full rollout payloads.
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
open -gj "$HOME/.codex/statusbar/Codex Bar.app"
```
