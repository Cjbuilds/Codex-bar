#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { auditStateObject } from "./audit-privacy.mjs";

const ROOT = process.cwd();
const HOOK_SCRIPT = path.join(ROOT, "plugins", "codex-status-bar", "scripts", "hook.mjs");
const SWIFT_PACKAGE = path.join(ROOT, "plugins", "codex-status-bar", "app");
const FIXED_NOW = "2026-06-23T18:00:00.000Z";

async function runHook(eventName, payload, env) {
  const result = await run(process.execPath, [HOOK_SCRIPT, eventName], {
    env: {
      ...process.env,
      ...env,
      CODEX_STATUS_BAR_NO_LAUNCH: "1",
    },
    input: `${JSON.stringify(payload)}\n`,
  });
  if (result.code !== 0) {
    throw new Error(`hook ${eventName} exited ${result.code}: ${result.stderr.trim() || result.stdout.trim()}`);
  }
}

async function renderState(statePath, nowIso = FIXED_NOW) {
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
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr?.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("error", (error) => resolve({ code: 127, stdout, stderr: error.message }));
    child.on("exit", (code) => resolve({ code: code ?? 1, stdout, stderr }));
    if (options.input) child.stdin.end(options.input);
    else child.stdin.end();
  });
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

async function readState(statePath) {
  return JSON.parse(await readFile(statePath, "utf8"));
}

function assertPrivacyClean(label, state) {
  const findings = auditStateObject(state);
  if (findings.length > 0) {
    throw new Error(`${label} state failed privacy audit:\n${findings.join("\n")}`);
  }
}

export async function runSmokeHookRender() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "codex-bar-hook-render-"));
  const statePath = path.join(dir, "state.json");
  const env = {
    CODEX_STATUS_BAR_HOME: dir,
    CODEX_STATUS_BAR_STATE: statePath,
  };
  const session = {
    session_id: "hook-render-session",
    cwd: path.join(os.tmpdir(), "codex-bar-hook-render-project"),
    model: "gpt-5.5",
  };

  try {
    await runHook("UserPromptSubmit", session, env);
    await runHook("PermissionRequest", {
      ...session,
      tool_name: "Bash",
      matcher: "shell command",
    }, env);

    let state = await readState(statePath);
    assertPrivacyClean("approval", state);
    let rendered = await renderState(statePath);
    assertEqual(rendered.title, "Codex · !", "approval title");
    assertEqual(rendered.needsAttention, true, "approval attention flag");
    assertIncludes(rendered.menuLines, "1 session waiting for approval", "approval summary");
    assertIncludes(rendered.sessions.map((sessionRow) => sessionRow.title), "approval needed", "approval row");

    await runHook("PostToolUse", {
      ...session,
      tool_name: "update_plan",
      arguments: JSON.stringify({
        plan: [
          { step: "Capture approval hook", status: "completed" },
          { step: "Render native menu", status: "completed" },
          { step: "Publish proof", status: "in_progress" },
        ],
      }),
    }, env);

    state = await readState(statePath);
    assertPrivacyClean("progress", state);
    rendered = await renderState(statePath);
    assertEqual(rendered.title, "Codex · 2/3", "progress title");
    assertEqual(rendered.needsAttention, false, "progress attention flag");
    assertIncludes(rendered.menuLines, "2/3 tasks complete", "progress summary");
    assertIncludes(rendered.menuLines, "✓ Capture approval hook", "progress plan item");

    return {
      approvalTitle: "Codex · !",
      progressTitle: "Codex · 2/3",
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function main() {
  const result = await runSmokeHookRender();
  console.log("Codex Bar hook render smoke passed");
  console.log(`approval: ${result.approvalTitle}`);
  console.log(`progress: ${result.progressTitle}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
