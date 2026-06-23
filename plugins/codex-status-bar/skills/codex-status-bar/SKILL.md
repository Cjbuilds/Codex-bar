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
- It reads Codex metadata/goals, Codex desktop/session-index titles, and structured `update_plan` arguments, but it must not persist raw transcripts or full rollout payloads.
- It should not store prompt text, assistant output, command output, tool output, API keys, tokens, cookies, or passwords.

Useful commands from the repo root:

```bash
npm run setup:codex
npm run test
npm run test:swift
npm run smoke:hook-render
npm run smoke:live-render
npm run smoke:perf
npm run capture:menu
npm run build:app
npm run verify
```

When a user asks Codex to set up this repository on a Mac, prefer `npm run setup:codex`. It validates plugin metadata and hooks, builds and launches the app, waits for the live collector, renders the actual live state through the native formatter, samples live CPU/RSS usage, runs reducer/native-render smoke checks, exercises public hook approval rendering, writes permission-free AppKit menu snapshots, and audits the live state file for privacy leaks.

If the app does not appear, check:

```bash
ls -la ~/.codex/statusbar
open -gj "$HOME/.codex/statusbar/Codex Bar.app"
```

For a real clicked menu screenshot, use `npm run capture:menu` on macOS after granting Screen Recording permission to the terminal app. The command preflights Screen Recording before launching its reversible live demo. This is manual and should not be treated as a CI gate.
