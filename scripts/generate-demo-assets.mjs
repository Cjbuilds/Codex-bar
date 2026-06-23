#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const OUTPUT_PATH = path.join(ROOT, "docs", "assets", "codex-bar-preview.svg");

const demo = {
  title: "Codex 1 · 4/5",
  summary: "4/5 tasks complete",
  sessions: [
    ["Codex 1", "Codex status bar", "4/5 tasks"],
    ["Codex 2", "Connect Codex to Fitbit", "42m"],
    ["Codex 3", "Finetuner evaluation set", "done"],
  ],
  steps: [
    ["done", "Identify current Codex thread/goal state source"],
    ["done", "Redesign menu bar UI"],
    ["done", "Implement richer auto-updating state"],
    ["done", "Verify app behavior and CI"],
    ["active", "Prepare release assets"],
  ],
};

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function stepSymbol(status) {
  if (status === "done") return "✓";
  if (status === "active") return "…";
  return "·";
}

function svg() {
  const sessionRows = demo.sessions.map((session, index) => {
    const y = 348 + index * 42;
    const statusColor = session[2].includes("tasks") ? "#0F766E" : session[2] === "active" ? "#2563EB" : "#64748B";
    return `
      <g>
        <text x="88" y="${y}" class="row-title">${escapeXml(session[0])}</text>
        <text x="178" y="${y}" class="row-meta">·</text>
        <text x="198" y="${y}" class="row-meta">${escapeXml(session[1])}</text>
        <rect x="596" y="${y - 22}" width="112" height="28" rx="6" fill="${statusColor}" opacity="0.12"/>
        <text x="652" y="${y - 3}" text-anchor="middle" class="row-status" fill="${statusColor}">${escapeXml(session[2])}</text>
      </g>`;
  }).join("");

  const stepRows = demo.steps.map((step, index) => {
    const y = 500 + index * 28;
    const color = step[0] === "active" ? "#0F766E" : "#334155";
    return `
      <g>
        <text x="92" y="${y}" class="step-symbol" fill="${color}">${escapeXml(stepSymbol(step[0]))}</text>
        <text x="124" y="${y}" class="step-text">${escapeXml(step[1])}</text>
      </g>`;
  }).join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="820" height="760" viewBox="0 0 820 760" role="img" aria-labelledby="title desc">
  <title id="title">Codex Bar preview</title>
  <desc id="desc">A preview of the Codex Bar macOS menu showing task progress, sessions, and deep-link actions.</desc>
  <style>
    .ui { font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif; }
    .title { font-size: 42px; font-weight: 700; fill: #0F172A; }
    .subtitle { font-size: 20px; fill: #475569; }
    .menubar { font-size: 17px; fill: #0F172A; font-weight: 600; }
    .menu-title { font-size: 18px; fill: #0F172A; font-weight: 700; }
    .row-title { font-size: 16px; fill: #0F172A; font-weight: 700; }
    .row-meta { font-size: 15px; fill: #475569; }
    .row-status { font-size: 13px; font-weight: 700; }
    .step-symbol { font-size: 18px; font-weight: 800; }
    .step-text { font-size: 15px; fill: #334155; }
    .action { font-size: 15px; fill: #0F172A; }
    .caption { font-size: 14px; fill: #64748B; }
  </style>
  <rect width="820" height="760" fill="#F8FAFC"/>
  <g class="ui">
    <text x="72" y="92" class="title">Codex Bar</text>
    <text x="72" y="126" class="subtitle">A compact macOS menu bar dashboard for live Codex progress.</text>

    <rect x="72" y="166" width="680" height="52" rx="0" fill="#FFFFFF"/>
    <line x1="72" y1="218" x2="752" y2="218" stroke="#CBD5E1"/>
    <text x="92" y="199" class="menubar">Finder</text>
    <text x="176" y="199" class="menubar">File</text>
    <text x="238" y="199" class="menubar">Edit</text>
    <rect x="514" y="176" width="154" height="32" rx="6" fill="#E2E8F0"/>
    <text x="591" y="198" text-anchor="middle" class="menubar">${escapeXml(demo.title)}</text>
    <text x="690" y="198" class="caption">9:41 AM</text>

    <rect x="72" y="238" width="680" height="450" rx="8" fill="#FFFFFF" stroke="#CBD5E1"/>
    <text x="88" y="282" class="menu-title">${escapeXml(demo.summary)}</text>
    <line x1="88" y1="306" x2="736" y2="306" stroke="#E2E8F0"/>
    ${sessionRows}
    <line x1="88" y1="462" x2="736" y2="462" stroke="#E2E8F0"/>
    ${stepRows}
    <line x1="88" y1="620" x2="736" y2="620" stroke="#E2E8F0"/>
    <text x="88" y="650" class="action">Open Codex</text>
    <text x="88" y="674" class="action">Quit Codex Bar</text>

    <text x="72" y="706" class="caption">Generated preview. The app is a native AppKit menu item plus local collector.</text>
  </g>
</svg>
`;
}

async function main() {
  const body = svg();
  if (process.argv.includes("--check")) {
    const current = await readFile(OUTPUT_PATH, "utf8").catch(() => null);
    if (current !== body) {
      console.error(`${path.relative(ROOT, OUTPUT_PATH)} is out of date. Run npm run generate:assets.`);
      process.exitCode = 1;
    }
    return;
  }

  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, body);
  console.log(path.relative(ROOT, OUTPUT_PATH));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
