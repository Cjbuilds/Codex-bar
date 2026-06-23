import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

import { expectedTag, validateReleaseTag } from "../scripts/check-release-tag.mjs";

test("plugin manifest has publishable metadata", async () => {
  const manifest = JSON.parse(await readFile("plugins/codex-status-bar/.codex-plugin/plugin.json", "utf8"));
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));

  assert.equal(manifest.name, "codex-status-bar");
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.equal(manifest.version, packageJson.version);
  assert.equal(manifest.license, "MIT");
  assert.equal(manifest.skills, "./skills/");
  assert.equal(manifest.interface.displayName, "Codex Bar");
  assert.equal(manifest.interface.websiteURL, "https://github.com/Cjbuilds/Codex-bar");
  assert.equal(Array.isArray(manifest.interface.defaultPrompt), true);
  assert.equal(Array.isArray(manifest.interface.screenshots), true);
  assert.equal(manifest.interface.logo, "./assets/icon.svg");
  assert.equal(manifest.interface.composerIcon, "./assets/icon.svg");
  assert.deepEqual(manifest.interface.screenshots, ["./assets/preview.svg"]);
  await access("plugins/codex-status-bar/assets/icon.svg");
  await access("plugins/codex-status-bar/assets/preview.svg");
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

test("release tag must match package version", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));
  const tag = expectedTag(packageJson.version);

  assert.doesNotThrow(() => validateReleaseTag(tag, packageJson.version));
  assert.throws(
    () => validateReleaseTag("v9.9.9", packageJson.version),
    /must match package version/
  );
});
