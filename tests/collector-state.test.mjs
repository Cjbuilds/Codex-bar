import assert from "node:assert/strict";
import test from "node:test";

import {
  buildStateFromSources,
  extractProgressFromArguments,
  summarizeRolloutText,
} from "../plugins/codex-status-bar/scripts/collector.mjs";

test("extractProgressFromArguments reads update_plan task counts", () => {
  const progress = extractProgressFromArguments(JSON.stringify({
    plan: [
      { step: "Design status rows", status: "completed" },
      { step: "Wire deep links", status: "in_progress" },
      { step: "Verify app", status: "pending" },
    ],
  }));

  assert.equal(progress.done, 1);
  assert.equal(progress.total, 3);
  assert.equal(progress.items[1].step, "Wire deep links");
});

test("summarizeRolloutText ignores messages and keeps structured plan metadata", () => {
  const rollout = [
    {
      timestamp: "2026-06-23T01:00:00.000Z",
      type: "response_item",
      payload: { type: "message", content: [{ type: "output_text", text: "private prompt-like text" }] },
    },
    {
      timestamp: "2026-06-23T01:00:01.000Z",
      type: "response_item",
      payload: {
        type: "function_call",
        name: "update_plan",
        arguments: JSON.stringify({
          plan: [
            { step: "Design status rows", status: "completed" },
            { step: "Wire deep links", status: "in_progress" },
          ],
        }),
      },
    },
  ].map((entry) => JSON.stringify(entry)).join("\n");

  const summary = summarizeRolloutText(rollout);

  assert.equal(summary.progress.done, 1);
  assert.equal(summary.progress.total, 2);
  assert.deepEqual(JSON.stringify(summary).includes("private prompt-like text"), false);
});

test("buildStateFromSources produces compact session dashboard state", () => {
  const now = new Date("2026-06-23T01:05:00.000Z");
  const threadId = "019ef1c5-dc24-73e3-ad5e-c8b833719e2f";
  const state = buildStateFromSources({
    now,
    previousState: null,
    threads: [{
      id: threadId,
      cwd: "/Users/me/Fix things",
      rollout_path: "/tmp/rollout.jsonl",
      created_at_ms: Date.parse("2026-06-23T00:00:00.000Z"),
      updated_at_ms: Date.parse("2026-06-23T01:04:00.000Z"),
      recency_at_ms: Date.parse("2026-06-23T01:04:00.000Z"),
      source: "vscode",
    }],
    goals: [{
      thread_id: threadId,
      status: "active",
      token_budget: null,
      tokens_used: 123,
      time_used_seconds: 300,
      created_at_ms: Date.parse("2026-06-23T00:00:00.000Z"),
      updated_at_ms: Date.parse("2026-06-23T01:04:00.000Z"),
    }],
    rolloutSummaries: {
      [threadId]: {
        progress: {
          label: "tasks",
          done: 2,
          total: 5,
          items: [],
          source: "test",
        },
        currentTool: "terminal",
        lastEvent: "function_call",
        lastActivityAtMs: Date.parse("2026-06-23T01:04:30.000Z"),
        toolCallsStarted: 4,
        toolCallsCompleted: 3,
        turnsStarted: 1,
        turnsCompleted: 0,
        openToolCall: true,
      },
    },
  });

  const session = state.sessions[threadId];
  assert.equal(state.headline, "2/5 tasks");
  assert.equal(state.aggregate.runningSessions, 1);
  assert.equal(session.displayName, "Codex 1");
  assert.equal(session.openURL, `codex://threads/${threadId}`);
  assert.equal(session.status, "running");
  assert.equal(session.progress.done, 2);
  assert.equal(session.goal.status, "active");
});
