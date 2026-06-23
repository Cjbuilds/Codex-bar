# Security

## Threat Model

Codex Bar is a local status indicator. It should not become a second logging pipeline for Codex.

Design constraints:

- Hook input is treated as untrusted JSON.
- Hook stdin is capped at 1 MiB.
- State writes are lock-protected and atomic.
- State files are written with user-only permissions.
- The app reads its own state file and starts a local collector for Codex metadata.
- The collector reads thread ids, working directories, Codex desktop/session-index titles, timestamps, goal rows, and structured `update_plan` arguments from recent rollout tails.
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

Short session labels are derived from Codex desktop title cache entries, `session_index.jsonl` titles, or local Codex database titles only when the database title is distinct from the first prompt/preview. Raw prompt-like `title`, `preview`, and `first_user_message` values are not promoted to menu labels. When no safe Codex-generated title is available, the collector falls back to the project name so the native menu renders `Untitled session`. Labels are capped, sanitized, and stored only in the local state file. They can still reveal the subject of the work. Set `CODEX_STATUS_BAR_HIDE_TITLES=1` before launching the app or collector to use folder names instead.

Run `npm run audit:privacy` to check the live `state.json` against the minimized schema and reject raw payload/transcript/output-shaped fields, multiline strings, HTTP URLs, and common secret-looking values. The same audit is also exercised by the no-side-effect smoke state test.

Run `npm run audit:freshness` to check that visible idle/completed sessions are from the current local day. Active, approval-needed, running, goal, and compacting sessions remain visible across days so real work is not hidden.

Run `npm run audit:integration-boundary` to check that the repository still treats Codex Bar as a separate native menu item and does not add code paths that patch, inject into, or modify `Codex.app`. The only allowed `Codex.app` reference is the read-only fallback to Codex's bundled Node binary.

`npm run demo:live` uses generated minimized demo state only. It launches the native app with the collector disabled and a temporary state path, then removes that state and restores the normal app if it was running.

## Reporting

Please open a private security advisory or email the maintainer before publishing a vulnerability. If the repo is not yet public, contact the maintainer directly.
