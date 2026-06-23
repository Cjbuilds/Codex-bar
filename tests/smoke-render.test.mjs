import assert from "node:assert/strict";
import test from "node:test";

import { assertRenderedPhase } from "../scripts/smoke-render.mjs";

const baseRendered = {
  title: "Codex 1 · 2/3",
  tooltip: "2/3 tasks complete",
  menuLines: [
    "2/3 tasks complete",
    "Codex 1 · Fix things · Build Codex status bar · 2/3 tasks",
    "✓ Read Codex session title",
  ],
  needsAttention: false,
  sessions: [{
    id: "demo-codex-status-bar",
    title: "Codex 1 · Fix things · Build Codex status bar · 2/3 tasks",
    detail: "Running · Build Codex status bar · terminal",
    openURL: "codex://threads/demo-codex-status-bar",
    needsAttention: false,
  }],
};

test("assertRenderedPhase accepts a complete progress render", () => {
  assert.doesNotThrow(() => assertRenderedPhase({ label: "progress" }, baseRendered));
});

test("assertRenderedPhase rejects missing Codex deep links", () => {
  const rendered = structuredClone(baseRendered);
  rendered.sessions[0].openURL = null;

  assert.throws(
    () => assertRenderedPhase({ label: "progress" }, rendered),
    /openURL expected/
  );
});

test("assertRenderedPhase rejects rows without folder and Codex session title", () => {
  const rendered = structuredClone(baseRendered);
  rendered.sessions[0].title = "Codex 1 · 2/3 tasks";

  assert.throws(
    () => assertRenderedPhase({ label: "progress" }, rendered),
    /Codex number, folder, and session title/
  );
});
