import assert from "node:assert/strict";
import test from "node:test";

import {
  buildStateFromSources,
  extractProgressFromArguments,
  queryThreads,
  readCodexThreadTitles,
  readDesktopThreadTitles,
  readSessionIndex,
  sessionLabel,
  sessionLabelInfo,
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
  assert.equal(session.labelSource, "codex-session-index");
  assert.equal(session.openURL, `codex://threads/${threadId}`);
  assert.equal(session.status, "running");
  assert.equal(session.progress.done, 2);
  assert.equal(session.goal.status, "active");
});

test("sessionLabel prefers Codex session index titles over prompt-like database titles", () => {
  const info = sessionLabelInfo({
    indexedTitle: "Build Codex status bar",
    title: "[m1ckc3s/claude-status-bar](https://github.com/m1ckc3s/claude-status-bar)\n\nhow this is built? can we do it for codex?",
    preview: "how this is built? can we do it for codex?",
  }, "Fix things");

  assert.equal(info.label, "Build Codex status bar");
  assert.equal(info.source, "codex-session-index");
  assert.equal(sessionLabel({
    indexedTitle: "Build Codex status bar",
    title: "unused",
    preview: "unused",
  }, "Fix things"), "Build Codex status bar");
});

test("sessionLabel keeps exact Codex-generated titles for native display skimming", () => {
  const longTitle = "Connect Codex with Fitbit Air using OAuth callback setup and local health permission checks";
  const info = sessionLabelInfo({
    indexedTitle: longTitle,
    title: "connect codex with fitbit air",
    preview: "connect codex with fitbit air",
  }, "Fix things");

  assert.ok(longTitle.length > 60);
  assert.equal(info.label, longTitle);
  assert.equal(info.source, "codex-session-index");
});

test("sessionLabel uses generated Codex database titles when they differ from the prompt", () => {
  const info = sessionLabelInfo({
    title: "Set up finetuner CLI",
    preview: [
      "Set up the finetuner CLI on my machine and log me in.",
      "",
      "Steps:",
      "1. Install the CLI.",
      "2. Log in with my license key.",
    ].join("\n"),
    first_user_message: [
      "Set up the finetuner CLI on my machine and log me in.",
      "",
      "Steps:",
      "1. Install the CLI.",
      "2. Log in with my license key.",
    ].join("\n"),
  }, "Finetuner testing");

  assert.equal(info.label, "Set up finetuner CLI");
  assert.equal(info.source, "codex-db-title");
});

test("sessionLabel rejects database titles that are only prompt casing or punctuation changes", () => {
  const info = sessionLabelInfo({
    title: "What model are you",
    preview: "what model are you?",
    first_user_message: "what model are you?",
  }, "Fix things");

  assert.equal(info.label, "Fix things");
  assert.equal(info.source, "project");
});

test("sessionLabel does not promote raw prompt blocks or their one-line previews as Codex titles", () => {
  const info = sessionLabelInfo({
    title: "[m1ckc3s/claude-status-bar](https://github.com/m1ckc3s/claude-status-bar)\n\nhow this is built? can we do it for codex?",
    preview: "how this is built? can we do it for codex?",
  }, "Fix things");

  assert.equal(info.label, "Fix things");
  assert.equal(info.source, "project");
});

test("sessionLabel ignores clean one-line prompt titles when no Codex-generated title exists", () => {
  const info = sessionLabelInfo({
    title: "how this is built? can we do it for codex?",
    preview: "how this is built? can we do it for codex?",
  }, "Fix things");

  assert.equal(info.label, "Fix things");
  assert.equal(info.source, "project");
});

test("sessionLabel does not derive session labels from raw multiline prompt titles", () => {
  const info = sessionLabelInfo({
    title: [
      "Set up the finetuner CLI on my machine and log me in.",
      "",
      "Steps:",
      "1. Install the CLI.",
      "2. Log in with my license key:",
      "   finetuner login --api-key ft_shouldNotBecomeTheTitle123456",
    ].join("\n"),
    preview: "Set up the finetuner CLI on my machine and log me in.",
  }, "Finetuner testing");

  assert.equal(info.label, "Finetuner testing");
  assert.equal(info.source, "project");
});

test("sessionLabel rejects secret-looking Codex titles", () => {
  const info = sessionLabelInfo({
    title: "Run finetuner login --api-key ft_shouldNeverBeShownInTheMenu123456",
    preview: "Run finetuner login --api-key ft_shouldNeverBeShownInTheMenu123456",
  }, "Finetuner testing");

  assert.equal(info.label, "Finetuner testing");
  assert.equal(info.source, "project");
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
    JSON.stringify({ thread_id: "thread-b", title: "Other thread", updated_at: "2026-06-22T11:30:00Z" }),
    "not json",
  ].join("\n"));

  const titles = await readSessionIndex(indexPath);

  assert.equal(titles["thread-a"].threadName, "New generated title");
  assert.equal(titles["thread-b"].threadName, "Other thread");
  assert.equal(titles["thread-b"].source, "session_index");
});

test("readDesktopThreadTitles reads Codex desktop thread-title cache", async (t) => {
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = await mkdtemp(join(tmpdir(), "codex-bar-desktop-titles-"));
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  const statePath = join(dir, "global-state.json");
  await writeFile(statePath, JSON.stringify({
    "electron-persisted-atom-state": {
      "thread-titles": {
        titles: {
          "thread-a": "Build Codex status bar",
          "thread-b": { title: "Connect Codex to Fitbit", updatedAt: "2026-06-23T12:00:00Z" },
        },
      },
    },
  }));

  const titles = await readDesktopThreadTitles(statePath);

  assert.equal(titles["thread-a"].threadName, "Build Codex status bar");
  assert.equal(titles["thread-a"].source, "desktop-thread-titles");
  assert.equal(titles["thread-b"].threadName, "Connect Codex to Fitbit");
  assert.equal(titles["thread-b"].updatedAt, "2026-06-23T12:00:00Z");
});

test("readCodexThreadTitles prefers Codex desktop titles over session index titles", async (t) => {
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = await mkdtemp(join(tmpdir(), "codex-bar-title-sources-"));
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  const sessionIndexFile = join(dir, "session_index.jsonl");
  const desktopStateFile = join(dir, "global-state.json");
  await writeFile(sessionIndexFile, JSON.stringify({
    id: "thread-a",
    thread_name: "Older generated title",
    updated_at: "2026-06-22T12:00:00Z",
  }));
  await writeFile(desktopStateFile, JSON.stringify({
    "electron-persisted-atom-state": {
      "thread-titles": {
        titles: {
          "thread-a": "Current Codex app title",
        },
      },
    },
  }));

  const titles = await readCodexThreadTitles({ sessionIndexFile, desktopStateFile });

  assert.equal(titles["thread-a"].threadName, "Current Codex app title");
  assert.equal(titles["thread-a"].source, "desktop-thread-titles");
});

test("queryThreads supports Codex state schemas without recency_at_ms", async (t) => {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const run = promisify(execFile);
  const dir = await mkdtemp(join(tmpdir(), "codex-bar-old-state-db-"));
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  const dbPath = join(dir, "state_5.sqlite");
  await run("sqlite3", [dbPath, [
    "create table threads (id text primary key, cwd text not null, title text not null, preview text not null, rollout_path text not null, created_at integer not null, updated_at integer not null, source text not null, archived integer not null default 0)",
    "insert into threads (id, cwd, title, preview, rollout_path, created_at, updated_at, source, archived) values ('thread-a', '/Users/me/Fix things', 'first prompt', 'first prompt', '/tmp/rollout.jsonl', 1782180000, 1782180123, 'vscode', 0)",
  ].join(";")]);

  const threads = await queryThreads(dbPath, 5);

  assert.equal(threads.length, 1);
  assert.equal(threads[0].id, "thread-a");
  assert.equal(threads[0].first_user_message, "");
  assert.equal(threads[0].created_at_ms, 1782180000000);
  assert.equal(threads[0].updated_at_ms, 1782180123000);
  assert.equal(threads[0].recency_at_ms, 1782180123000);
});

test("queryThreads returns first user messages for prompt-title checks when available", async (t) => {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const run = promisify(execFile);
  const dir = await mkdtemp(join(tmpdir(), "codex-bar-first-message-db-"));
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  const dbPath = join(dir, "state_5.sqlite");
  await run("sqlite3", [dbPath, [
    "create table threads (id text primary key, cwd text not null, title text not null, preview text not null, first_user_message text not null, rollout_path text not null, created_at integer not null, updated_at integer not null, source text not null, archived integer not null default 0)",
    "insert into threads (id, cwd, title, preview, first_user_message, rollout_path, created_at, updated_at, source, archived) values ('thread-a', '/Users/me/Fix things', 'Set up finetuner CLI', 'Set up the finetuner CLI on my machine and log me in.', 'Set up the finetuner CLI on my machine and log me in.', '/tmp/rollout.jsonl', 1782180000, 1782180123, 'vscode', 0)",
  ].join(";")]);

  const threads = await queryThreads(dbPath, 5);

  assert.equal(threads.length, 1);
  assert.equal(threads[0].title, "Set up finetuner CLI");
  assert.equal(threads[0].first_user_message, "Set up the finetuner CLI on my machine and log me in.");
});

test("buildStateFromSources keeps previous Codex-generated title over weak prompt fallback", () => {
  const threadId = "019ef1c5-dc24-73e3-ad5e-c8b833719e2f";
  const now = new Date("2026-06-23T01:05:00.000Z");
  const state = buildStateFromSources({
    now,
    previousState: {
      sessions: {
        [threadId]: {
          label: "Build Codex status bar",
          labelSource: "codex-session-index",
          lastActivityAt: "2026-06-23T01:04:00.000Z",
        },
      },
    },
    goals: [],
    rolloutSummaries: {},
    threads: [{
      id: threadId,
      cwd: "/Users/me/Fix things",
      title: "[m1ckc3s/claude-status-bar](https://github.com/m1ckc3s/claude-status-bar)\n\nhow this is built? can we do it for codex?",
      preview: "how this is built? can we do it for codex?",
      rollout_path: null,
      created_at_ms: Date.parse("2026-06-23T00:00:00.000Z"),
      updated_at_ms: Date.parse("2026-06-23T01:04:00.000Z"),
      recency_at_ms: Date.parse("2026-06-23T01:04:00.000Z"),
      source: "app",
    }],
  });

  assert.equal(state.sessions[threadId].label, "Build Codex status bar");
  assert.equal(state.sessions[threadId].labelSource, "codex-session-index-cache");
});

test("buildStateFromSources prefers desktop Codex titles and caches them over weak fallback", () => {
  const threadId = "019ef1c5-dc24-73e3-ad5e-c8b833719e2f";
  const now = new Date("2026-06-23T01:05:00.000Z");
  const state = buildStateFromSources({
    now,
    previousState: null,
    threadNames: {
      [threadId]: { threadName: "Current Codex app title", source: "desktop-thread-titles" },
    },
    goals: [],
    rolloutSummaries: {},
    threads: [{
      id: threadId,
      cwd: "/Users/me/Fix things",
      title: "[m1ckc3s/claude-status-bar](https://github.com/m1ckc3s/claude-status-bar)\n\nhow this is built? can we do it for codex?",
      preview: "how this is built? can we do it for codex?",
      rollout_path: null,
      created_at_ms: Date.parse("2026-06-23T00:00:00.000Z"),
      updated_at_ms: Date.parse("2026-06-23T01:04:00.000Z"),
      recency_at_ms: Date.parse("2026-06-23T01:04:00.000Z"),
      source: "app",
    }],
  });

  assert.equal(state.sessions[threadId].label, "Current Codex app title");
  assert.equal(state.sessions[threadId].labelSource, "codex-desktop-title");

  const cached = buildStateFromSources({
    now: new Date("2026-06-23T01:06:00.000Z"),
    previousState: state,
    goals: [],
    rolloutSummaries: {},
    threads: [{
      id: threadId,
      cwd: "/Users/me/Fix things",
      title: "[m1ckc3s/claude-status-bar](https://github.com/m1ckc3s/claude-status-bar)\n\nhow this is built? can we do it for codex?",
      preview: "how this is built? can we do it for codex?",
      rollout_path: null,
      created_at_ms: Date.parse("2026-06-23T00:00:00.000Z"),
      updated_at_ms: Date.parse("2026-06-23T01:05:00.000Z"),
      recency_at_ms: Date.parse("2026-06-23T01:05:00.000Z"),
      source: "app",
    }],
  });

  assert.equal(cached.sessions[threadId].label, "Current Codex app title");
  assert.equal(cached.sessions[threadId].labelSource, "codex-desktop-title-cache");
});

test("buildStateFromSources uses generated database titles and caches them over weak fallback", () => {
  const threadId = "019edc16-b2a1-74d1-94c9-bb9430697670";
  const now = new Date("2026-06-23T18:00:00.000Z");
  const state = buildStateFromSources({
    now,
    previousState: null,
    goals: [],
    rolloutSummaries: {},
    threads: [{
      id: threadId,
      cwd: "/Users/me/Finetuner testing",
      title: "Set up finetuner CLI",
      preview: [
        "Set up the finetuner CLI on my machine and log me in.",
        "",
        "Steps:",
        "1. Install the CLI.",
      ].join("\n"),
      first_user_message: [
        "Set up the finetuner CLI on my machine and log me in.",
        "",
        "Steps:",
        "1. Install the CLI.",
      ].join("\n"),
      rollout_path: null,
      created_at_ms: Date.parse("2026-06-23T17:00:00.000Z"),
      updated_at_ms: Date.parse("2026-06-23T17:54:00.000Z"),
      recency_at_ms: Date.parse("2026-06-23T17:54:00.000Z"),
      source: "app",
    }],
  });

  assert.equal(state.sessions[threadId].label, "Set up finetuner CLI");
  assert.equal(state.sessions[threadId].labelSource, "codex-db-title");

  const cached = buildStateFromSources({
    now: new Date("2026-06-23T18:01:00.000Z"),
    previousState: state,
    goals: [],
    rolloutSummaries: {},
    threads: [{
      id: threadId,
      cwd: "/Users/me/Finetuner testing",
      title: "Set up the finetuner CLI on my machine and log me in.",
      preview: "Set up the finetuner CLI on my machine and log me in.",
      first_user_message: "Set up the finetuner CLI on my machine and log me in.",
      rollout_path: null,
      created_at_ms: Date.parse("2026-06-23T17:00:00.000Z"),
      updated_at_ms: Date.parse("2026-06-23T17:55:00.000Z"),
      recency_at_ms: Date.parse("2026-06-23T17:55:00.000Z"),
      source: "app",
    }],
  });

  assert.equal(cached.sessions[threadId].label, "Set up finetuner CLI");
  assert.equal(cached.sessions[threadId].labelSource, "codex-db-title-cache");
});

test("buildStateFromSources replaces stale prompt excerpts with project fallback", () => {
  const threadId = "019ef578-adaf-7c40-bbff-935c5403b19f";
  const now = new Date("2026-06-23T18:00:00.000Z");
  const state = buildStateFromSources({
    now,
    previousState: {
      sessions: {
        [threadId]: {
          label: "Set up the finetuner CLI on my machine and log me in.",
          labelSource: "codex-thread-title-excerpt",
          lastActivityAt: "2026-06-23T17:54:00.000Z",
        },
      },
    },
    goals: [],
    rolloutSummaries: {},
    threads: [{
      id: threadId,
      cwd: "/Users/me/Finetuner testing",
      title: [
        "Set up the finetuner CLI on my machine and log me in.",
        "",
        "Steps:",
        "1. Install the CLI.",
        "2. Log in with a license key.",
      ].join("\n"),
      preview: "Set up the finetuner CLI on my machine and log me in.",
      rollout_path: null,
      created_at_ms: Date.parse("2026-06-23T17:00:00.000Z"),
      updated_at_ms: Date.parse("2026-06-23T17:54:00.000Z"),
      recency_at_ms: Date.parse("2026-06-23T17:54:00.000Z"),
      source: "app",
    }],
  });

  assert.equal(state.sessions[threadId].label, "Finetuner testing");
  assert.equal(state.sessions[threadId].labelSource, "project");
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
