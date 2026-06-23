import assert from "node:assert/strict";
import test from "node:test";

import {
  auditFreshnessObject,
  parseArgs,
} from "../scripts/audit-freshness.mjs";

function stateWith(session) {
  return {
    version: 1,
    sessions: {
      "thread-a": {
        id: "thread-a",
        status: "idle",
        approvalRequired: false,
        lastActivityAt: "2026-06-23T10:10:00.000Z",
        ...session,
      },
    },
  };
}

test("auditFreshnessObject accepts idle or completed sessions from the current local day", () => {
  const now = new Date("2026-06-23T18:00:00.000Z");

  assert.deepEqual(auditFreshnessObject(stateWith({ status: "idle" }), { now }), []);
  assert.deepEqual(auditFreshnessObject(stateWith({ status: "completed" }), { now }), []);
});

test("auditFreshnessObject rejects visible idle or completed sessions from previous local days", () => {
  const now = new Date("2026-06-23T18:00:00.000Z");

  const idleFindings = auditFreshnessObject(stateWith({
    status: "idle",
    lastActivityAt: "2026-06-22T10:10:00.000Z",
  }), { now });
  const completedFindings = auditFreshnessObject(stateWith({
    status: "completed",
    lastActivityAt: "2026-06-22T10:10:00.000Z",
  }), { now });

  assert.match(idleFindings[0], /stale idle session/);
  assert.match(completedFindings[0], /stale completed session/);
});

test("auditFreshnessObject keeps active and attention sessions visible across days", () => {
  const now = new Date("2026-06-23T18:00:00.000Z");

  for (const status of ["approval", "running", "thinking", "active", "goal", "compacting"]) {
    assert.deepEqual(auditFreshnessObject(stateWith({
      status,
      lastActivityAt: "2026-06-22T10:10:00.000Z",
    }), { now }), []);
  }

  assert.deepEqual(auditFreshnessObject(stateWith({
    status: "idle",
    approvalRequired: true,
    lastActivityAt: "2026-06-22T10:10:00.000Z",
  }), { now }), []);
});

test("auditFreshnessObject rejects non-active visible sessions without activity timestamps", () => {
  const now = new Date("2026-06-23T18:00:00.000Z");
  const state = stateWith({ lastActivityAt: null, updatedAt: null });

  const findings = auditFreshnessObject(state, { now });

  assert.match(findings[0], /without a valid lastActivityAt/);
});

test("parseArgs supports state and current-time overrides", () => {
  const parsed = parseArgs(["--state", "/tmp/state.json", "--now=2026-06-23T18:00:00.000Z"], {});

  assert.equal(parsed.statePath, "/tmp/state.json");
  assert.equal(parsed.now.toISOString(), "2026-06-23T18:00:00.000Z");
  assert.throws(() => parseArgs(["--now", "not a date"], {}), /valid date/);
});
