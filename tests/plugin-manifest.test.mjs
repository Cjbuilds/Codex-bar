import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("plugin manifest has publishable metadata", async () => {
  const manifest = JSON.parse(await readFile("plugins/codex-status-bar/.codex-plugin/plugin.json", "utf8"));

  assert.equal(manifest.name, "codex-status-bar");
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.equal(manifest.license, "MIT");
  assert.equal(manifest.skills, "./skills/");
  assert.equal(manifest.interface.displayName, "Codex Status Bar");
  assert.equal(Array.isArray(manifest.interface.defaultPrompt), true);
  assert.equal(Array.isArray(manifest.interface.screenshots), true);
  assert.equal(JSON.stringify(manifest).includes("[TODO:"), false);
});

test("repo marketplace points at the plugin folder", async () => {
  const marketplace = JSON.parse(await readFile(".agents/plugins/marketplace.json", "utf8"));
  const entry = marketplace.plugins.find((plugin) => plugin.name === "codex-status-bar");

  assert.ok(entry);
  assert.equal(entry.source.source, "local");
  assert.equal(entry.source.path, "./plugins/codex-status-bar");
  assert.equal(entry.policy.installation, "AVAILABLE");
  assert.equal(entry.policy.authentication, "ON_INSTALL");
  assert.equal(entry.category, "Productivity");
});
