# Codex Integration Boundary

Codex Bar runs as a separate native macOS menu bar app. It does not patch, replace, inject into, or modify `Codex.app`.

This boundary is based on the current documented Codex extension surfaces:

- Codex plugins document skills, apps, and MCP servers as the reusable workflow units a plugin can bundle.
- Codex build-plugin docs document plugin manifests, marketplace entries, MCP config, app integrations, and lifecycle hooks.
- Codex hooks document command handlers for lifecycle events such as `SessionStart`, `PreToolUse`, `PermissionRequest`, `PostToolUse`, and `Stop`.

Those documented surfaces are enough for Codex Bar to collect local lifecycle and session metadata safely, but they do not document a supported API for injecting custom items into Codex Desktop's own menu bar menu.

Codex Bar therefore uses these supported boundaries:

- Plugin lifecycle hooks start the app and write minimized status metadata.
- The native app owns its own macOS menu bar item.
- Session rows use `codex://threads/<thread-id>` deep links back into Codex.
- The only allowed `Codex.app` filesystem reference is the read-only fallback
  path to Codex's bundled Node binary when a system Node is unavailable.

If Codex later documents a first-party app menu extension API, replace this
boundary with that API instead of app-bundle mutation.

Sources checked on 2026-06-23:

- https://developers.openai.com/codex/plugins
- https://developers.openai.com/codex/plugins/build
- https://developers.openai.com/codex/hooks
