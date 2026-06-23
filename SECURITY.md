# Security

## Threat Model

Codex Bar is a local status indicator. It should not become a second logging pipeline for Codex.

Design constraints:

- Hook input is treated as untrusted JSON.
- Hook stdin is capped at 1 MiB.
- State writes are lock-protected and atomic.
- State files are written with user-only permissions.
- The app reads its own state file and starts a local collector for Codex metadata.
- The collector reads thread ids, working directories, short Codex-generated session titles, thread titles/previews, timestamps, goal rows, and structured `update_plan` arguments from recent rollout tails.
- The project does not patch, inject into, or modify `Codex.app`.
- The project does not persist raw Codex conversation transcripts, model responses, command output, tool results, or full rollout payloads.
- The project does not send telemetry over the network.

## Sensitive Data Policy

The state file must not contain:

- Full prompt text or raw first-user messages.
- Assistant responses.
- Command output.
- Tool results.
- API keys, access tokens, cookies, or passwords.
- Full hook or rollout payload dumps.

Only minimized metadata should be stored, such as session id, cwd/project name, short session label, event type, tool name, counts, timestamps, goal status, deep-link URL, and progress summaries.

Short session labels are derived from Codex-generated session titles by default, with thread titles/previews used only as a fallback. Labels are capped, sanitized, and stored only in the local state file. They can still reveal the subject of the work. Set `CODEX_STATUS_BAR_HIDE_TITLES=1` before launching the app or collector to use folder names instead.

## Reporting

Please open a private security advisory or email the maintainer before publishing a vulnerability. If the repo is not yet public, contact the maintainer directly.
