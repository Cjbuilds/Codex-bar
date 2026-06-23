# Codex Bar Agent Guide

Use this file when Codex is asked to set up, verify, or change this repository.

## First Setup Command

Run this from the repository root after cloning or when a user pastes this repo into Codex:

```bash
npm run setup:codex
```

That is the supported agent path. It validates plugin metadata and hooks, builds and launches the native macOS menu bar app, waits for the collector, renders the live installed state, samples CPU/RSS, exercises approval/progress/completed state, generates native AppKit snapshots plus the HTML visual proof, and audits the live state file for privacy leaks.

## Verification Commands

Use these checks for the matching change scope:

```bash
npm run verify
npm run setup:codex
npm run audit:readiness
npm run audit:privacy
npm run smoke:live-render
npm run smoke:visual-proof
```

`npm run verify` is the full CI/release gate. `npm run setup:codex` is the first-install gate a Codex agent should run for a user.

## Safety Rules

- Do not patch, replace, or modify `Codex.app`.
- Do not persist raw Codex transcripts, prompts, model responses, command output, tool output, full rollout payloads, API keys, access tokens, cookies, passwords, or other secret values.
- Keep `~/.codex/statusbar/state.json` as minimized dashboard state only.
- Keep hook work bounded; hooks should update minimized state and launch the app, not poll or perform heavy parsing.
- Session labels must come from Codex desktop/session-index generated titles. Do not promote raw SQLite `threads.title` or `preview` values into menu labels.
- If no safe Codex-generated session title exists, use the project/folder fallback in state and let the native menu render `Untitled session`.
- Keep `package.json`, plugin manifest version, and the generated app bundle version in sync.

## Useful Paths

- Native app: `plugins/codex-status-bar/app/`
- Hook reducer: `plugins/codex-status-bar/scripts/hook.mjs`
- Local collector: `plugins/codex-status-bar/scripts/collector.mjs`
- Setup verifier: `scripts/setup-codex-bar.mjs`
- Release readiness audit: `scripts/audit-readiness.mjs`
- Native visual proof: `scripts/smoke-visual-proof.mjs`
- Privacy audit: `scripts/audit-privacy.mjs`

## Known Limits

- Codex Bar is a separate native macOS menu item. There is no documented public Codex plugin API for nesting this UI under Codex Desktop's own menu item.
- A real clicked menu screenshot requires macOS Screen Recording permission. Use `npm run capture:menu` only on a permitted local terminal; do not make it a CI gate.
- Developer ID notarization requires Apple Developer credentials. The release workflow supports those secrets, but local ad-hoc signing is the default without them.
