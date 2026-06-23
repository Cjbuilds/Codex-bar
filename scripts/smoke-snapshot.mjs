#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { auditStateObject } from "./audit-privacy.mjs";
import { demoStates } from "./demo-live.mjs";
import { assertRenderedPhase } from "./smoke-render.mjs";

const ROOT = process.cwd();
const SWIFT_PACKAGE = path.join(ROOT, "plugins", "codex-status-bar", "app");
const FIXED_NOW = "2026-06-23T18:00:00.000Z";
const DEMO_THREAD_URL = "codex://threads/demo-codex-status-bar";
const DEFAULT_OUTPUT_DIR = path.join(ROOT, "dist", "snapshots");

export function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    outputDir: DEFAULT_OUTPUT_DIR,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const [key, inlineValue] = arg.split("=", 2);
    const nextValue = () => inlineValue ?? argv[++index];
    switch (key) {
      case "--output-dir":
        options.outputDir = path.resolve(nextValue());
        break;
      default:
        throw new Error(`unknown option ${arg}`);
    }
  }

  return options;
}

export function assertSnapshotReport(phase, report, expectedOutput) {
  if (!report || typeof report !== "object") {
    throw new Error(`${phase.label} snapshot did not return a report object`);
  }
  if (report.output !== expectedOutput) {
    throw new Error(`${phase.label} snapshot output expected ${expectedOutput} but got ${JSON.stringify(report.output)}`);
  }
  if (report.width < 700 || report.height < 300) {
    throw new Error(`${phase.label} snapshot dimensions are too small: ${report.width}x${report.height}`);
  }
  if (report.fileSize < 8_000) {
    throw new Error(`${phase.label} snapshot file is too small to be useful: ${report.fileSize} bytes`);
  }
  if (report.nonBackgroundPixels < 4_000) {
    throw new Error(`${phase.label} snapshot looks blank: ${report.nonBackgroundPixels} non-background pixels`);
  }

  assertRenderedPhase(phase, {
    title: report.title,
    menuLines: report.menuLines,
    sessions: report.sessions,
    needsAttention: report.needsAttention,
  });
}

async function snapshotState({ statePath, outputPath, nowIso = FIXED_NOW }) {
  const result = await run("swift", [
    "run",
    "--quiet",
    "--package-path",
    SWIFT_PACKAGE,
    "CodexStatusBarSnapshot",
    "--state",
    statePath,
    "--now",
    nowIso,
    "--output",
    outputPath,
  ]);
  if (result.code !== 0) {
    throw new Error(`native snapshot exited ${result.code}: ${result.stderr.trim() || result.stdout.trim()}`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`native snapshot did not return JSON: ${error.message}\n${result.stdout}`);
  }
}

async function run(command, args, options = {}) {
  return await new Promise((resolve) => {
    const child = spawn(command, args, {
      ...options,
      stdio: options.stdio || ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr?.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("error", (error) => resolve({ code: 127, stdout, stderr: error.message }));
    child.on("exit", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

function withDemoThreadURL(state) {
  const next = structuredClone(state);
  for (const session of Object.values(next.sessions || {})) {
    session.openURL = DEMO_THREAD_URL;
  }
  return next;
}

export async function runSmokeSnapshot(options = parseArgs()) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "codex-bar-snapshot-smoke-"));
  try {
    const reports = [];
    for (const phase of demoStates(new Date(FIXED_NOW))) {
      const state = withDemoThreadURL(phase.state);
      const auditFindings = auditStateObject(state);
      if (auditFindings.length > 0) {
        throw new Error(`${phase.label} snapshot state failed privacy audit:\n${auditFindings.join("\n")}`);
      }

      const statePath = path.join(tempDir, `${phase.label}.json`);
      const outputPath = path.join(options.outputDir, `codex-bar-${phase.label}.png`);
      await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
      const report = await snapshotState({ statePath, outputPath });
      assertSnapshotReport(phase, report, outputPath);
      reports.push({ label: phase.label, title: report.title, output: report.output, nonBackgroundPixels: report.nonBackgroundPixels });
    }
    return reports;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function main() {
  const reports = await runSmokeSnapshot(parseArgs());
  console.log("Codex Bar native snapshot smoke passed");
  for (const report of reports) {
    console.log(`${report.label}: ${report.title} -> ${path.relative(ROOT, report.output)} (${report.nonBackgroundPixels} marked pixels)`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
