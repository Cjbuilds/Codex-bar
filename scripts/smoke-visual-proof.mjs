#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { runSmokeSnapshot } from "./smoke-snapshot.mjs";

const ROOT = process.cwd();
const DEFAULT_SNAPSHOT_DIR = path.join(ROOT, "dist", "snapshots");
const DEFAULT_OUTPUT = path.join(ROOT, "dist", "visual-proof", "codex-bar-native-proof.html");

export function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    output: DEFAULT_OUTPUT,
    snapshotDir: DEFAULT_SNAPSHOT_DIR,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const [key, inlineValue] = arg.split("=", 2);
    const nextValue = () => inlineValue ?? argv[++index];
    switch (key) {
      case "--output":
        options.output = path.resolve(nextValue());
        break;
      case "--snapshot-dir":
        options.snapshotDir = path.resolve(nextValue());
        break;
      default:
        throw new Error(`unknown option ${arg}`);
    }
  }

  return options;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function relativeImagePath(outputPath, imagePath) {
  return path.relative(path.dirname(outputPath), imagePath).split(path.sep).join("/");
}

export function renderVisualProofHtml({ reports, outputPath = DEFAULT_OUTPUT } = {}) {
  if (!Array.isArray(reports) || reports.length === 0) {
    throw new Error("visual proof requires at least one native snapshot report");
  }

  const frameDurationSeconds = 3;
  const totalDurationSeconds = reports.length * frameDurationSeconds;
  const frames = reports.map((report, index) => {
    if (!report?.label || !report?.title || !report?.output) {
      throw new Error("visual proof reports must include label, title, and output");
    }
    const src = relativeImagePath(outputPath, report.output);
    const label = escapeHtml(report.label);
    const title = escapeHtml(report.title);
    const delay = index * frameDurationSeconds;
    return `        <figure class="proof-frame" style="--delay: ${delay}s">
          <img src="${escapeHtml(src)}" alt="Codex Bar ${label} native AppKit snapshot">
          <figcaption>
            <span>${label}</span>
            <strong>${title}</strong>
          </figcaption>
        </figure>`;
  }).join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Codex Bar Native Visual Proof</title>
  <style>
    :root {
      color-scheme: light;
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Arial, sans-serif;
      background: #f5f5f4;
      color: #1c1917;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 32px;
    }
    main {
      width: min(920px, 100%);
    }
    h1 {
      margin: 0 0 8px;
      font-size: 24px;
      line-height: 1.2;
      font-weight: 650;
      letter-spacing: 0;
    }
    p {
      max-width: 720px;
      margin: 0 0 20px;
      color: #57534e;
      font-size: 14px;
      line-height: 1.5;
    }
    .proof-stage {
      position: relative;
      width: 100%;
      aspect-ratio: 82 / 43;
      border: 1px solid #d6d3d1;
      background: #fafaf9;
      overflow: hidden;
      box-shadow: 0 18px 55px rgba(28, 25, 23, 0.14);
    }
    .proof-frame {
      position: absolute;
      inset: 0;
      margin: 0;
      opacity: 0;
      animation: proof-cycle ${totalDurationSeconds}s infinite;
      animation-delay: var(--delay);
    }
    .proof-frame img {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .proof-frame figcaption {
      position: absolute;
      left: 16px;
      bottom: 16px;
      display: flex;
      align-items: center;
      gap: 10px;
      max-width: calc(100% - 32px);
      padding: 7px 10px;
      border: 1px solid rgba(214, 211, 209, 0.88);
      background: rgba(250, 250, 249, 0.92);
      color: #292524;
      font-size: 13px;
      line-height: 1.2;
      backdrop-filter: blur(12px);
    }
    .proof-frame figcaption span {
      color: #0f766e;
      font-weight: 650;
      text-transform: uppercase;
      font-size: 11px;
    }
    .proof-frame figcaption strong {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-weight: 600;
    }
    @keyframes proof-cycle {
      0%, 28% { opacity: 1; }
      33%, 100% { opacity: 0; }
    }
    @media (prefers-reduced-motion: reduce) {
      body { place-items: start center; }
      .proof-stage {
        display: grid;
        gap: 16px;
        aspect-ratio: auto;
        border: 0;
        background: transparent;
        box-shadow: none;
        overflow: visible;
      }
      .proof-frame {
        position: relative;
        opacity: 1;
        animation: none;
        border: 1px solid #d6d3d1;
        background: #fafaf9;
      }
    }
  </style>
</head>
<body>
  <main>
    <h1>Codex Bar Native Visual Proof</h1>
    <p>Generated from the same permission-free AppKit snapshot path used by CI. It cycles approval, active progress, and completed menu states without requiring macOS Screen Recording permission.</p>
    <section class="proof-stage" aria-label="Animated Codex Bar native snapshots">
${frames}
    </section>
  </main>
</body>
</html>
`;
}

export function assertVisualProofHtml(html, reports, outputPath = DEFAULT_OUTPUT) {
  if (!html.includes("Codex Bar Native Visual Proof")) {
    throw new Error("visual proof is missing its title");
  }
  if (!html.includes("@keyframes proof-cycle")) {
    throw new Error("visual proof is missing animation keyframes");
  }
  for (const report of reports) {
    if (!html.includes(`>${escapeHtml(report.label)}<`)) {
      throw new Error(`visual proof is missing ${report.label} frame label`);
    }
    if (!html.includes(escapeHtml(report.title))) {
      throw new Error(`visual proof is missing ${report.label} frame title`);
    }
    const src = relativeImagePath(outputPath, report.output);
    if (html.includes(src) || html.includes(path.basename(report.output))) continue;
    throw new Error(`visual proof is missing ${report.label} image source`);
  }
}

export async function runVisualProof(options = parseArgs()) {
  const reports = await runSmokeSnapshot({ outputDir: options.snapshotDir });
  const html = renderVisualProofHtml({ reports, outputPath: options.output });
  assertVisualProofHtml(html, reports, options.output);
  await mkdir(path.dirname(options.output), { recursive: true });
  await writeFile(options.output, html);
  return { output: options.output, reports };
}

export async function main() {
  const result = await runVisualProof(parseArgs());
  console.log("Codex Bar native visual proof passed");
  console.log(`proof: ${path.relative(ROOT, result.output)}`);
  for (const report of result.reports) {
    console.log(`${report.label}: ${report.title} -> ${path.relative(ROOT, report.output)} (${report.nonBackgroundPixels} marked pixels)`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
