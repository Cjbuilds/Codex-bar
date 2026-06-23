# Security

## Threat Model

Codex Bar is a local status indicator. It should not become a second logging pipeline for Codex.

Design constraints:

- Hook input is treated as untrusted JSON.
- Hook stdin is capped at 1 MiB.
- State writes are lock-protected and atomic.
- State files are written with user-only permissions.
- The app reads its own state file and starts a local collector for Codex metadata.
- The collector reads thread ids, working directories, timestamps, goal rows, and structured `update_plan` arguments from recent rollout tails.
- The project does not patch, inject into, or modify `Codex.app`.
- The project does not persist raw Codex conversation transcripts, model responses, command output, tool results, or full rollout payloads.
- The project does not send telemetry over the network.

## Sensitive Data Policy

The state file must not contain:

- Prompt text.
- Assistant responses.
- Command output.
- Tool results.
- API keys, access tokens, cookies, or passwords.
- Full hook or rollout payload dumps.

Only derived metadata should be stored, such as session id, cwd/project name, event type, tool name, counts, timestamps, goal status, deep-link URL, and progress summaries.

## Reporting

Please open a private security advisory or email the maintainer before publishing a vulnerability. If the repo is not yet public, contact the maintainer directly.
