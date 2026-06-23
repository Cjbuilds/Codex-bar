import assert from "node:assert/strict";
import test from "node:test";

import {
  assertVisualProofHtml,
  parseArgs,
  renderVisualProofHtml,
} from "../scripts/smoke-visual-proof.mjs";

const outputPath = "/tmp/codex-bar-proof/index.html";
const reports = [
  {
    label: "approval",
    title: "Codex 1 · !",
    output: "/tmp/codex-bar-proof/snapshots/codex-bar-approval.png",
    nonBackgroundPixels: 22_000,
  },
  {
    label: "progress",
    title: "Codex 1 · 2/3",
    output: "/tmp/codex-bar-proof/snapshots/codex-bar-progress.png",
    nonBackgroundPixels: 21_000,
  },
  {
    label: "completed",
    title: "Codex 1 · done",
    output: "/tmp/codex-bar-proof/snapshots/codex-bar-completed.png",
    nonBackgroundPixels: 20_000,
  },
];

test("parseArgs accepts visual proof output paths", () => {
  const options = parseArgs([
    "--output", "/tmp/proof.html",
    "--snapshot-dir=/tmp/snapshots",
  ]);

  assert.equal(options.output, "/tmp/proof.html");
  assert.equal(options.snapshotDir, "/tmp/snapshots");
});

test("renderVisualProofHtml cycles native snapshot frames", () => {
  const html = renderVisualProofHtml({ reports, outputPath });

  assert.match(html, /Codex Bar Native Visual Proof/);
  assert.match(html, /@keyframes proof-cycle/);
  assert.match(html, /codex-bar-approval\.png/);
  assert.match(html, /codex-bar-progress\.png/);
  assert.match(html, /codex-bar-completed\.png/);
  assert.match(html, />approval</);
  assert.match(html, />progress</);
  assert.match(html, />completed</);
  assert.match(html, /Codex 1 · 2\/3/);
  assert.doesNotThrow(() => assertVisualProofHtml(html, reports, outputPath));
});

test("renderVisualProofHtml rejects empty or incomplete reports", () => {
  assert.throws(() => renderVisualProofHtml({ reports: [], outputPath }), /at least one/);
  assert.throws(() => renderVisualProofHtml({ reports: [{ label: "approval" }], outputPath }), /label, title, and output/);
});

test("assertVisualProofHtml rejects missing frame context", () => {
  const html = renderVisualProofHtml({ reports, outputPath });

  assert.throws(
    () => assertVisualProofHtml(html.replace("Codex 1 · done", ""), reports, outputPath),
    /completed frame title/
  );
});
