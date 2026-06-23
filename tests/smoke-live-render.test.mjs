import assert from "node:assert/strict";
import test from "node:test";

import { assertLiveRender, parseArgs } from "../scripts/smoke-live-render.mjs";

const state = {
  version: 1,
  sessions: {
    "thread-1": {
      id: "thread-1",
      threadId: "thread-1",
      project: "Fix things",
      label: "Build Codex status bar",
      labelSource: "codex-desktop-title",
      progress: {
        label: "tasks",
        done: 2,
        total: 4,
        items: [],
      },
    },
  },
};

const rendered = {
  title: "Codex 1 · 2/4",
  menuLines: [
    "2/4 tasks complete",
    "Codex 1 · Fix things · Build Codex status bar · 2/4 tasks",
  ],
  sessions: [{
    id: "thread-1",
    title: "Codex 1 · Fix things · Build Codex status bar · 2/4 tasks",
    detail: "Running · Build Codex status bar",
    openURL: "codex://threads/thread-1",
    needsAttention: false,
  }],
};

test("assertLiveRender accepts live rows with folder, title, progress, and deep link", () => {
  assert.doesNotThrow(() => assertLiveRender(state, rendered));
});

test("assertLiveRender rejects rows without Codex deep links", () => {
  const broken = structuredClone(rendered);
  broken.sessions[0].openURL = null;

  assert.throws(
    () => assertLiveRender(state, broken),
    /deep link/
  );
});

test("assertLiveRender rejects rows without folder and session title context", () => {
  const broken = structuredClone(rendered);
  broken.sessions[0].title = "Codex 1 · 2/4 tasks";

  assert.throws(
    () => assertLiveRender(state, broken),
    /folder, session title, and work state/
  );
});

test("assertLiveRender rejects rows that drop live progress", () => {
  const broken = structuredClone(rendered);
  broken.sessions[0].title = "Codex 1 · Fix things · Build Codex status bar · running";

  assert.throws(
    () => assertLiveRender(state, broken),
    /expected 2\/4/
  );
});

test("assertLiveRender rejects prompt-derived session title sources", () => {
  const brokenState = structuredClone(state);
  brokenState.sessions["thread-1"].labelSource = "codex-preview";

  assert.throws(
    () => assertLiveRender(brokenState, rendered),
    /prompt-derived label source/
  );
});

test("assertLiveRender requires a live session unless allow-empty is used", () => {
  const emptyState = { version: 1, sessions: {} };
  const emptyRender = { title: "Codex", menuLines: [], sessions: [] };

  assert.throws(
    () => assertLiveRender(emptyState, emptyRender),
    /no sessions/
  );
  assert.doesNotThrow(() => assertLiveRender(emptyState, emptyRender, { requireSession: false }));
});

test("parseArgs supports live render smoke options", () => {
  assert.deepEqual(
    parseArgs(["--state", "/tmp/state.json", "--now=2026-06-23T18:00:00Z", "--allow-empty"], {}),
    {
      statePath: "/tmp/state.json",
      now: "2026-06-23T18:00:00Z",
      requireSession: false,
    }
  );
});
