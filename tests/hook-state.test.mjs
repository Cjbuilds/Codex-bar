import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  parseHookInput,
  sessionIdFrom,
  updateState,
  withStateLock,
  readState,
  writeStateAtomic,
} from "../plugins/codex-status-bar/scripts/hook.mjs";

const fixedDate = new Date("2026-06-22T18:00:00.000Z");

test("parseHookInput ignores malformed JSON", () => {
  assert.deepEqual(parseHookInput("{ nope"), {});
});

test("sessionIdFrom falls back to a stable cwd hash", () => {
  const first = sessionIdFrom({ cwd: "/tmp/project", transcript_path: "/tmp/session.jsonl" }, {});
  const second = sessionIdFrom({ cwd: "/tmp/project", transcript_path: "/tmp/session.jsonl" }, {});
  assert.equal(first, second);
  assert.match(first, /^local-/);
});

test("sessionIdFrom uses Codex thread id from hook environment", () => {
  const id = sessionIdFrom({ cwd: "/tmp/project" }, {
    CODEX_THREAD_ID: "019ef1c5-dc24-73e3-ad5e-c8b833719e2f",
  });

  assert.equal(id, "019ef1c5-dc24-73e3-ad5e-c8b833719e2f");
});

test("updateState tracks approval, progress, and completion", () => {
  const env = {};
  let state = updateState(null, "UserPromptSubmit", {
    session_id: "s1",
    cwd: "/tmp/project",
    model: "gpt-5.5",
  }, fixedDate, env);

  assert.equal(state.aggregate.runningSessions, 1);
  assert.equal(state.sessions.s1.turnsStarted, 1);

  state = updateState(state, "PreToolUse", {
    session_id: "s1",
    cwd: "/tmp/project",
    tool_name: "Bash",
  }, new Date(fixedDate.getTime() + 1000), env);

  assert.equal(state.current.status, "running");
  assert.equal(state.sessions.s1.currentTool, "Bash");

  state = updateState(state, "PermissionRequest", {
    session_id: "s1",
    cwd: "/tmp/project",
    tool_name: "Bash",
  }, new Date(fixedDate.getTime() + 2000), env);

  assert.equal(state.attention, "approval");
  assert.equal(state.aggregate.approvalsRequired, 1);

  state = updateState(state, "PostToolUse", {
    session_id: "s1",
    cwd: "/tmp/project",
    tool_name: "update_plan",
    arguments: JSON.stringify({
      plan: [
        { step: "Build app", status: "completed" },
        { step: "Run tests", status: "in_progress" },
      ],
    }),
  }, new Date(fixedDate.getTime() + 3000), env);

  assert.equal(state.progress.done, 1);
  assert.equal(state.progress.total, 2);
  assert.equal(state.sessions.s1.progress.done, 1);
  assert.equal(state.sessions.s1.progress.total, 2);
  assert.equal(state.sessions.s1.approvalRequired, false);

  state = updateState(state, "Stop", {
    session_id: "s1",
    cwd: "/tmp/project",
  }, new Date(fixedDate.getTime() + 4000), env);

  assert.equal(state.aggregate.runningSessions, 0);
  assert.equal(state.aggregate.completedSessions, 1);
  assert.equal(state.headline, "1 completed");
  assert.equal(state.progress, null);
  assert.equal(state.sessions.s1.progress, null);
  assert.equal(state.sessions.s1.approvalRequired, false);
});

test("UserPromptSubmit clears stale session progress before a new turn", () => {
  const env = {};
  let state = updateState(null, "UserPromptSubmit", {
    session_id: "s1",
    cwd: "/tmp/project",
  }, fixedDate, env);

  state = updateState(state, "PostToolUse", {
    session_id: "s1",
    cwd: "/tmp/project",
    tool_name: "update_plan",
    arguments: JSON.stringify({
      plan: [
        { step: "First task", status: "completed" },
        { step: "Second task", status: "pending" },
      ],
    }),
  }, new Date(fixedDate.getTime() + 1000), env);

  assert.equal(state.sessions.s1.progress.done, 1);

  state = updateState(state, "UserPromptSubmit", {
    session_id: "s1",
    cwd: "/tmp/project",
  }, new Date(fixedDate.getTime() + 2000), env);

  assert.equal(state.progress, null);
  assert.equal(state.sessions.s1.progress, null);
});

test("state writes are atomic and lock-protected", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "codex-status-bar-test-"));
  const statePath = path.join(dir, "state.json");
  try {
    await withStateLock(statePath, async () => {
      const state = updateState(null, "UserPromptSubmit", {
        session_id: "s1",
        cwd: "/tmp/project",
      }, fixedDate, {});
      await writeStateAtomic(statePath, state);
    });

    const raw = await readFile(statePath, "utf8");
    assert.match(raw, /"version": 1/);
    const state = await readState(statePath);
    assert.equal(state.sessions.s1.project, "project");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
