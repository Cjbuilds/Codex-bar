import assert from "node:assert/strict";
import test from "node:test";

import {
  assertCleanCheckoutFiles,
  cleanCheckoutCommands,
  parseArgs,
} from "../scripts/smoke-clean-checkout.mjs";

const requiredFiles = [
  "AGENTS.md",
  "package.json",
  "README.md",
  "SECURITY.md",
  "plugins/codex-status-bar/.codex-plugin/plugin.json",
  "plugins/codex-status-bar/app/Package.swift",
  "plugins/codex-status-bar/scripts/collector.mjs",
];

test("parseArgs supports clean checkout controls", () => {
  const options = parseArgs([
    "--root", "/tmp/codex-bar",
    "--tmp-dir=/tmp/codex-bar-clean",
    "--tracked-only",
    "--keep",
    "--skip-package",
  ]);

  assert.equal(options.root, "/tmp/codex-bar");
  assert.equal(options.tempRoot, "/tmp/codex-bar-clean");
  assert.equal(options.includeUntracked, false);
  assert.equal(options.keep, true);
  assert.equal(cleanCheckoutCommands(options).some((step) => step.args.join(" ") === "run package:release"), false);
});

test("cleanCheckoutCommands runs bounded repo checks", () => {
  assert.deepEqual(cleanCheckoutCommands().map((step) => step.args.join(" ")), [
    "run check:assets",
    "run validate:plugin",
    "run audit:readiness",
    "run test",
    "run package:release",
  ]);
});

test("assertCleanCheckoutFiles accepts the required Git-visible files", () => {
  assert.doesNotThrow(() => assertCleanCheckoutFiles(requiredFiles));
});

test("assertCleanCheckoutFiles rejects missing setup-critical files", () => {
  assert.throws(
    () => assertCleanCheckoutFiles(requiredFiles.filter((file) => file !== "AGENTS.md")),
    /missing AGENTS\.md/
  );
});

test("assertCleanCheckoutFiles rejects local-only artifacts and unsafe paths", () => {
  assert.throws(() => assertCleanCheckoutFiles([...requiredFiles, "dist/app.zip"]), /dist artifacts/);
  assert.throws(() => assertCleanCheckoutFiles([...requiredFiles, "node_modules/pkg/index.js"]), /node_modules/);
  assert.throws(() => assertCleanCheckoutFiles([...requiredFiles, ".git/config"]), /\.git metadata/);
  assert.throws(() => assertCleanCheckoutFiles([...requiredFiles, "../outside"]), /unsafe/);
});
