import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  appPath,
  parseArgs,
  processPatterns,
  statusRoot,
} from "../scripts/install-local.mjs";

test("parseArgs supports local install controls", () => {
  const options = parseArgs([
    "--no-open",
    "--no-live",
    "--live-timeout-ms=5000",
    "--interval-ms", "1000",
  ]);

  assert.equal(options.open, false);
  assert.equal(options.live, false);
  assert.equal(options.liveTimeoutMs, 5000);
  assert.equal(options.intervalMs, 1000);
});

test("parseArgs rejects intervals longer than the live timeout", () => {
  assert.throws(
    () => parseArgs(["--live-timeout-ms", "1000", "--interval-ms", "2000"]),
    /less than or equal/
  );
});

test("install paths honor Codex Bar environment overrides", () => {
  const env = {
    CODEX_HOME: path.join(os.tmpdir(), "codex-home"),
    CODEX_STATUS_BAR_HOME: path.join(os.tmpdir(), "codex-bar-home"),
  };

  assert.equal(statusRoot(env), env.CODEX_STATUS_BAR_HOME);
  assert.equal(appPath(env), path.join(env.CODEX_STATUS_BAR_HOME, "Codex Bar.app"));
  assert.equal(appPath({ ...env, CODEX_STATUS_BAR_APP: "/tmp/Custom.app" }), "/tmp/Custom.app");
});

test("processPatterns target the app and bundled collector", () => {
  const patterns = processPatterns("/tmp/Codex Bar.app");

  assert.deepEqual(patterns, [
    "/tmp/Codex Bar.app/Contents/MacOS/CodexStatusBar",
    "/tmp/Codex Bar.app/Contents/Resources/collector.mjs --watch",
  ]);
});
