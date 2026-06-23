import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const supportedEvents = new Set([
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PermissionRequest",
  "PostToolUse",
  "PreCompact",
  "PostCompact",
  "SubagentStart",
  "SubagentStop",
  "Stop",
]);

test("plugin hook file uses supported Codex events and bounded commands", async () => {
  const hooks = JSON.parse(await readFile("plugins/codex-status-bar/hooks/hooks.json", "utf8"));
  assert.ok(hooks.hooks);

  for (const [eventName, groups] of Object.entries(hooks.hooks)) {
    assert.ok(supportedEvents.has(eventName), `unsupported hook event ${eventName}`);
    assert.ok(Array.isArray(groups));

    for (const group of groups) {
      assert.ok(Array.isArray(group.hooks));
      for (const hook of group.hooks) {
        assert.equal(hook.type, "command");
        assert.match(hook.command, /"\$PLUGIN_ROOT\/scripts\/hook\.mjs"/);
        assert.equal(hook.timeout, 10);
        assert.equal(hook.command.includes("cat "), false);
      }
    }
  }
});
