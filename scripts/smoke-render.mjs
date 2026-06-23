#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { auditStateObject } from "./audit-privacy.mjs";
import { demoStates } from "./demo-live.mjs";

const ROOT = process.cwd();
const SWIFT_PACKAGE = path.join(ROOT, "plugins", "codex-status-bar", "app");
const FIXED_NOW = "2026-06-23T18:00:00.000Z";
const DEMO_THREAD_URL = "codex://threads/demo-codex-status-bar";

export function assertRenderedPhase(phase, rendered) {
  if (!rendered || typeof rendered !== "object") {
    throw new Error(`${phase.label} render did not return an object`);
  }
  if (!Array.isArray(rendered.menuLines) || !Array.isArray(rendered.sessions)) {
    throw new Error(`${phase.label} render is missing menu lines or sessions`);
  }

  const firstSession = rendered.sessions[0];
  if (!firstSession) throw new Error(`${phase.label} render did not include a session row`);
  if (firstSession.openURL !== DEMO_THREAD_URL) {
    throw new Error(`${phase.label} row openURL expected ${DEMO_THREAD_URL} but got ${JSON.stringify(firstSession.openURL)}`);
  }
  if (!firstSession.title.includes("Codex 1 · Fix things · Build Codex status bar")) {
    throw new Error(`${phase.label} row did not include Codex number, folder, and session title: ${firstSession.title}`);
  }

  switch (phase.label) {
    case "approval":
      assertEqual(rendered.title, "Codex 1 · !", "approval title");
      assertEqual(rendered.needsAttention, true, "approval attention flag");
      assertIncludes(rendered.menuLines, "1 session waiting for approval", "approval summary");
      assertIncludes([firstSession.title], "approval needed", "approval row work");
      break;
    case "progress":
      assertEqual(rendered.title, "Codex 1 · 2/3", "progress title");
      assertEqual(rendered.needsAttention, false, "progress attention flag");
      assertIncludes(rendered.menuLines, "2/3 tasks complete", "progress summary");
      assertIncludes([firstSession.title], "2/3 tasks", "progress row work");
      assertIncludes(rendered.menuLines, "✓ Read Codex session title", "progress item");
      break;
    case "completed":
      assertEqual(rendered.title, "Codex 1 · done", "completed title");
      assertEqual(rendered.needsAttention, false, "completed attention flag");
      assertIncludes([firstSession.title], "goal complete", "completed row work");
      break;
    default:
      throw new Error(`unknown demo phase ${phase.label}`);
  }
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label} expected ${JSON.stringify(expected)} but got ${JSON.stringify(actual)}`);
  }
}

function assertIncludes(values, expected, label) {
  if (!values.some((value) => String(value).includes(expected))) {
    throw new Error(`${label} expected to include ${JSON.stringify(expected)} in ${JSON.stringify(values)}`);
  }
}

export async function renderState(statePath, nowIso = FIXED_NOW) {
  const result = await run("swift", [
    "run",
    "--quiet",
    "--package-path",
    SWIFT_PACKAGE,
    "CodexStatusBarRender",
    "--state",
    statePath,
    "--now",
    nowIso,
  ]);
  if (result.code !== 0) {
    throw new Error(`native render exited ${result.code}: ${result.stderr.trim() || result.stdout.trim()}`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`native render did not return JSON: ${error.message}\n${result.stdout}`);
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

export async function runSmokeRender() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "codex-bar-render-smoke-"));
  try {
    const phases = [];
    for (const phase of demoStates(new Date(FIXED_NOW))) {
      const state = withDemoThreadURL(phase.state);
      const auditFindings = auditStateObject(state);
      if (auditFindings.length > 0) {
        throw new Error(`${phase.label} render state failed privacy audit:\n${auditFindings.join("\n")}`);
      }
      const statePath = path.join(tempDir, `${phase.label}.json`);
      await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
      const rendered = await renderState(statePath);
      assertRenderedPhase(phase, rendered);
      phases.push({ label: phase.label, title: rendered.title });
    }
    return phases;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function main() {
  const phases = await runSmokeRender();
  console.log("Codex Bar native render smoke passed");
  for (const phase of phases) {
    console.log(`${phase.label}: ${phase.title}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
