import assert from "node:assert/strict";
import test from "node:test";

import { assertSnapshotReport, parseArgs } from "../scripts/smoke-snapshot.mjs";

const phase = { label: "progress" };
const output = "/tmp/codex-bar-progress.png";

const baseReport = {
  output,
  width: 820,
  height: 430,
  fileSize: 18_000,
  nonBackgroundPixels: 42_000,
  title: "Codex 1 · 2/3",
  needsAttention: false,
  menuLines: [
    "2/3 tasks complete",
    "Codex 1 · Fix things · Build Codex status bar · 2/3 tasks",
    "✓ Read Codex session title",
  ],
  sessions: [{
    id: "demo-codex-status-bar",
    title: "Codex 1 · Fix things · Build Codex status bar · 2/3 tasks",
    detail: "Running · Build Codex status bar · terminal",
    openURL: "codex://threads/demo-codex-status-bar",
    needsAttention: false,
  }],
};

test("parseArgs accepts an output directory", () => {
  assert.equal(parseArgs(["--output-dir", "/tmp/snapshots"]).outputDir, "/tmp/snapshots");
});

test("assertSnapshotReport accepts useful native snapshot metrics", () => {
  assert.doesNotThrow(() => assertSnapshotReport(phase, baseReport, output));
});

test("assertSnapshotReport rejects blank-looking snapshots", () => {
  assert.throws(
    () => assertSnapshotReport(phase, { ...baseReport, nonBackgroundPixels: 20 }, output),
    /looks blank/
  );
});

test("assertSnapshotReport rejects snapshots missing rendered row context", () => {
  const report = structuredClone(baseReport);
  report.sessions[0].title = "Codex 1 · 2/3 tasks";

  assert.throws(
    () => assertSnapshotReport(phase, report, output),
    /Codex number, folder, and session title/
  );
});
