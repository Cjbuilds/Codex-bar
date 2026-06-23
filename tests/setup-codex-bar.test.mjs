import assert from "node:assert/strict";
import test from "node:test";

import { parseArgs, setupSteps } from "../scripts/setup-codex-bar.mjs";

test("setup command runs the agent-facing install and verification path", () => {
  const steps = setupSteps(parseArgs(["--live-timeout-ms=5000", "--interval-ms", "500"]));

  assert.deepEqual(steps.map((step) => step.label), [
    "Validate plugin metadata and hooks",
    "Build, launch, and live-check Codex Bar",
    "Render live installed state through native formatter",
    "Sample live app and collector CPU/RSS",
    "Exercise approval, progress, and completed state reducer",
    "Render approval, progress, and completed states through native formatter",
    "Render public hook approval and progress states through native formatter",
    "Render permission-free AppKit menu snapshots",
    "Audit live minimized state for privacy leaks",
  ]);

  assert.deepEqual(steps[1].args, [
    "run",
    "install:local",
    "--",
    "--live-timeout-ms",
    "5000",
    "--interval-ms",
    "500",
  ]);
});

test("setup command can skip expensive or already-proven steps", () => {
  const steps = setupSteps(parseArgs([
    "--skip-install",
    "--skip-live-render-smoke",
    "--skip-perf-smoke",
    "--skip-render-smoke",
    "--skip-snapshot-smoke",
    "--skip-privacy-audit",
  ]));

  assert.deepEqual(steps.map((step) => step.args.join(" ")), [
    "run validate:plugin",
    "run smoke:state",
  ]);
});

test("setup command can run snapshot smoke without the formatter smokes", () => {
  const steps = setupSteps(parseArgs([
    "--skip-install",
    "--skip-live-render-smoke",
    "--skip-perf-smoke",
    "--skip-render-smoke",
    "--skip-privacy-audit",
  ]));

  assert.deepEqual(steps.map((step) => step.args.join(" ")), [
    "run validate:plugin",
    "run smoke:state",
    "run smoke:snapshot",
  ]);
});

test("setup command can run live render smoke without reinstalling", () => {
  const steps = setupSteps(parseArgs([
    "--skip-install",
    "--skip-state-smoke",
    "--skip-render-smoke",
    "--skip-snapshot-smoke",
    "--skip-perf-smoke",
    "--skip-privacy-audit",
  ]));

  assert.deepEqual(steps.map((step) => step.args.join(" ")), [
    "run validate:plugin",
    "run smoke:live-render",
  ]);
});

test("setup command can run performance smoke without reinstalling", () => {
  const steps = setupSteps(parseArgs([
    "--skip-install",
    "--skip-live-render-smoke",
    "--skip-state-smoke",
    "--skip-render-smoke",
    "--skip-snapshot-smoke",
    "--skip-privacy-audit",
  ]));

  assert.deepEqual(steps.map((step) => step.args.join(" ")), [
    "run validate:plugin",
    "run smoke:perf",
  ]);
});

test("setup command rejects invalid timing", () => {
  assert.throws(
    () => parseArgs(["--live-timeout-ms", "1000", "--interval-ms", "2000"]),
    /less than or equal/
  );
});
