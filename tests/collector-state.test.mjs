import assert from "node:assert/strict";
import test from "node:test";

import {
  buildStateFromSources,
  extractProgressFromArguments,
  readSessionIndex,
  sessionLabel,
  summarizeRolloutFile,
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

test("summarizeRolloutFile reuses cached summaries for unchanged files", async (t) => {
  const { mkdtemp, rm, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = await mkdtemp(join(tmpdir(), "codex-bar-rollout-cache-"));
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  const rolloutPath = join(dir, "rollout.jsonl");
  const cache = new Map();
  const firstRollout = JSON.stringify({
    timestamp: "2026-06-23T01:00:01.000Z",
    type: "response_item",
    payload: {
      type: "function_call",
      name: "update_plan",
      arguments: JSON.stringify({
        plan: [
          { step: "One", status: "completed" },
          { step: "Two", status: "pending" },
        ],
      }),
    },
  });
  await writeFile(rolloutPath, `${firstRollout}\n`);

  const first = await summarizeRolloutFile(rolloutPath, cache);
  const second = await summarizeRolloutFile(rolloutPath, cache);

  assert.equal(first.progress.done, 1);
  assert.equal(second, first);
  assert.equal(cache.size, 1);
});

test("buildStateFromSources produces compact session dashboard state", () => {
  const now = new Date("2026-06-23T01:05:00.000Z");
  const threadId = "019ef1c5-dc24-73e3-ad5e-c8b833719e2f";
  const state = buildStateFromSources({
    now,
    previousState: null,
    threadNames: {
      [threadId]: { threadName: "Build Codex status bar" },
    },
    threads: [{
      id: threadId,
      cwd: "/Users/me/Fix things",
      title: "[m1ckc3s/claude-status-bar](https://github.com/m1ckc3s/claude-status-bar)\n\nhow this is built? can we do it for codex?",
      preview: "[m1ckc3s/claude-status-bar](https://github.com/m1ckc3s/claude-status-bar)\n\nhow this is built? can we do it for codex?",
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
  assert.equal(session.label, "Build Codex status bar");
  assert.equal(session.openURL, `codex://threads/${threadId}`);
  assert.equal(session.status, "running");
  assert.equal(session.progress.done, 2);
  assert.equal(session.goal.status, "active");
});

test("sessionLabel prefers Codex session index titles over prompt-like database titles", () => {
  const label = sessionLabel({
    indexedTitle: "Build Codex status bar",
    title: "[m1ckc3s/claude-status-bar](https://github.com/m1ckc3s/claude-status-bar)\n\nhow this is built? can we do it for codex?",
    preview: "how this is built? can we do it for codex?",
  }, "Fix things");

  assert.equal(label, "Build Codex status bar");
});

test("sessionLabel prefers a readable task line and strips links", () => {
  const label = sessionLabel({
    title: "[m1ckc3s/claude-status-bar](https://github.com/m1ckc3s/claude-status-bar)\n\nhow this is built? can we do it for codex?",
    preview: "unused",
  }, "Fix things");

  assert.equal(label, "how this is built? can we do it for codex?");
});

test("readSessionIndex keeps the newest title per thread", async (t) => {
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = await mkdtemp(join(tmpdir(), "codex-bar-session-index-"));
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  const indexPath = join(dir, "session_index.jsonl");
  await writeFile(indexPath, [
    JSON.stringify({ id: "thread-a", thread_name: "Old generated title", updated_at: "2026-06-22T10:00:00Z" }),
    JSON.stringify({ id: "thread-a", thread_name: "New generated title", updated_at: "2026-06-22T11:00:00Z" }),
    JSON.stringify({ id: "thread-b", thread_name: "Other thread", updated_at: "2026-06-22T11:30:00Z" }),
    "not json",
  ].join("\n"));

  const titles = await readSessionIndex(indexPath);

  assert.equal(titles["thread-a"].threadName, "New generated title");
  assert.equal(titles["thread-b"].threadName, "Other thread");
});

test("sessionLabel can fall back to project names for privacy", () => {
  const label = sessionLabel({
    title: "connect codex to private project",
    preview: "connect codex to private project",
  }, "Workspace", { hideTitles: true });

  assert.equal(label, "Workspace");
});

test("buildStateFromSources hides old idle sessions but keeps today's idle work", () => {
  const now = new Date("2026-06-23T18:00:00.000Z");
  const todayId = "019ef1c5-dc24-73e3-ad5e-c8b833719e2f";
  const yesterdayId = "019ef217-6355-7770-8ba2-7c2a9099bb12";

  const state = buildStateFromSources({
    now,
    previousState: null,
    goals: [],
    rolloutSummaries: {},
    threads: [
      {
        id: todayId,
        cwd: "/Users/me/Fix things",
        title: "today's idle session",
        preview: "today's idle session",
        rollout_path: null,
        created_at_ms: Date.parse("2026-06-23T10:00:00.000Z"),
        updated_at_ms: Date.parse("2026-06-23T10:10:00.000Z"),
        recency_at_ms: Date.parse("2026-06-23T10:10:00.000Z"),
        source: "app",
      },
      {
        id: yesterdayId,
        cwd: "/Users/me/Fix things",
        title: "yesterday's idle session",
        preview: "yesterday's idle session",
        rollout_path: null,
        created_at_ms: Date.parse("2026-06-22T10:00:00.000Z"),
        updated_at_ms: Date.parse("2026-06-22T10:10:00.000Z"),
        recency_at_ms: Date.parse("2026-06-22T10:10:00.000Z"),
        source: "app",
      },
    ],
  });

  assert.ok(state.sessions[todayId]);
  assert.equal(state.sessions[yesterdayId], undefined);
  assert.equal(state.sessions[todayId].displayName, "Codex 1");
});
