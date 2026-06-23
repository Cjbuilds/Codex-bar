import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  auditStateObject,
  defaultStatePath,
  parseArgs,
} from "../scripts/audit-privacy.mjs";

function sampleState() {
  return {
    version: 1,
    installId: "install-a",
    updatedAt: "2026-06-23T02:00:00.000Z",
    attention: null,
    headline: "2/3 tasks",
    detail: "Codex 1 2/3 tasks",
    current: {
      status: "running",
      event: "PostToolUse",
      toolName: "Bash",
      startedAt: "2026-06-23T02:00:00.000Z",
    },
    progress: {
      label: "tasks",
      done: 2,
      total: 3,
      source: "rollout-update-plan",
      items: [
        { step: "Build install command", status: "completed" },
        { step: "Run privacy audit", status: "in_progress" },
      ],
    },
    aggregate: {
      runningSessions: 1,
      completedSessions: 0,
      approvalsRequired: 0,
      totalToolCalls: 4,
      activeSince: "2026-06-23T01:50:00.000Z",
    },
    sessions: {
      "thread-a": {
        id: "thread-a",
        threadId: "thread-a",
        shortId: "thread-a",
        displayName: "Codex 1",
        label: "Build Codex status bar",
        labelSource: "codex-session-index",
        openURL: "codex://threads/thread-a",
        cwd: "/Users/me/Fix things",
        project: "Fix things",
        model: null,
        status: "running",
        startedAt: "2026-06-23T01:45:00.000Z",
        updatedAt: "2026-06-23T02:00:00.000Z",
        lastActivityAt: "2026-06-23T02:00:00.000Z",
        completedAt: null,
        currentTurnStartedAt: "2026-06-23T01:50:00.000Z",
        currentTool: "terminal",
        lastEvent: "function_call",
        approvalRequired: false,
        turnsStarted: 1,
        turnsCompleted: 0,
        toolCallsStarted: 2,
        toolCallsCompleted: 2,
        progress: null,
        goal: {
          status: "active",
          tokenBudget: null,
          tokensUsed: 42,
          timeUsedSeconds: 120,
          createdAt: "2026-06-23T01:45:00.000Z",
          updatedAt: "2026-06-23T02:00:00.000Z",
        },
        stale: false,
      },
    },
  };
}

test("auditStateObject accepts the minimized state schema", () => {
  assert.deepEqual(auditStateObject(sampleState()), []);
});

test("auditStateObject rejects raw payload and output fields", () => {
  const state = sampleState();
  state.sessions["thread-a"].payload = { stdout: "secret command output" };

  const findings = auditStateObject(state);

  assert.ok(findings.some((finding) => finding.includes("payload")));
  assert.ok(findings.some((finding) => finding.includes("stdout")));
});

test("auditStateObject rejects multiline strings and HTTP URLs", () => {
  const state = sampleState();
  state.sessions["thread-a"].label = "first line\nsecond line";
  state.sessions["thread-a"].currentTool = "https://example.com/output";

  const findings = auditStateObject(state);

  assert.ok(findings.some((finding) => finding.includes("contains a newline")));
  assert.ok(findings.some((finding) => finding.includes("contains an HTTP URL")));
});

test("auditStateObject rejects secret-looking values", () => {
  const state = sampleState();
  state.detail = "sk-abcdefghijklmnopqrstuvwxyz123456";

  const findings = auditStateObject(state);

  assert.ok(findings.some((finding) => finding.includes("looks like a secret value")));
});

test("parseArgs and defaultStatePath honor state overrides", () => {
  const env = {
    CODEX_HOME: path.join(os.tmpdir(), "codex-home"),
    CODEX_STATUS_BAR_STATE: path.join(os.tmpdir(), "state.json"),
  };

  assert.equal(defaultStatePath(env), env.CODEX_STATUS_BAR_STATE);
  assert.equal(parseArgs(["--state", "/tmp/other-state.json"], env).statePath, "/tmp/other-state.json");
});
