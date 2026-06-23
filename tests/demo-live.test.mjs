import assert from "node:assert/strict";
import test from "node:test";

import { auditStateObject } from "../scripts/audit-privacy.mjs";
import { demoStates, parseArgs } from "../scripts/demo-live.mjs";

test("parseArgs supports live demo timing controls", () => {
  const options = parseArgs(["--phase-ms=2500", "--settle-ms", "750", "--no-restart"]);

  assert.equal(options.phaseMs, 2500);
  assert.equal(options.settleMs, 750);
  assert.equal(options.restartNormalApp, false);
});

test("parseArgs rejects invalid live demo timings", () => {
  assert.throws(() => parseArgs(["--phase-ms", "0"]), /positive number/);
  assert.throws(() => parseArgs(["--settle-ms", "nope"]), /positive number/);
});

test("demoStates produce privacy-audited approval, progress, and completed states", () => {
  const phases = demoStates(new Date("2026-06-23T03:15:00.000Z"));

  assert.deepEqual(phases.map((phase) => phase.label), ["approval", "progress", "completed"]);
  assert.equal(phases[0].state.attention, "approval");
  assert.equal(phases[0].state.aggregate.approvalsRequired, 1);
  assert.equal(phases[1].state.headline, "2/3 tasks");
  assert.equal(phases[1].state.progress.done, 2);
  assert.equal(phases[2].state.aggregate.completedSessions, 1);
  assert.equal(phases[2].state.sessions["demo-codex-status-bar"].status, "completed");

  for (const phase of phases) {
    assert.deepEqual(auditStateObject(phase.state), [], `${phase.label} demo state should pass privacy audit`);
  }
});
