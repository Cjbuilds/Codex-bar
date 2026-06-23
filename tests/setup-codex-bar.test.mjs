import assert from "node:assert/strict";
import test from "node:test";

import { parseArgs, setupSteps } from "../scripts/setup-codex-bar.mjs";

test("setup command runs the agent-facing install and verification path", () => {
  const steps = setupSteps(parseArgs(["--live-timeout-ms=5000", "--interval-ms", "500"]));

  assert.deepEqual(steps.map((step) => step.label), [
    "Validate plugin metadata and hooks",
    "Build, launch, and live-check Codex Bar",
    "Exercise approval, progress, and completed state reducer",
    "Render approval, progress, and completed states through native formatter",
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
    "--skip-render-smoke",
    "--skip-privacy-audit",
  ]));

  assert.deepEqual(steps.map((step) => step.args.join(" ")), [
    "run validate:plugin",
    "run smoke:state",
  ]);
});

test("setup command rejects invalid timing", () => {
  assert.throws(
    () => parseArgs(["--live-timeout-ms", "1000", "--interval-ms", "2000"]),
    /less than or equal/
  );
});
