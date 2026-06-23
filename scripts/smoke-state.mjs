#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const hookScript = path.join(ROOT, "plugins", "codex-status-bar", "scripts", "hook.mjs");

async function runHook(eventName, payload, env) {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [hookScript, eventName], {
      env: {
        ...process.env,
        ...env,
        CODEX_STATUS_BAR_NO_LAUNCH: "1",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`hook ${eventName} exited ${code}: ${stderr.trim()}`));
    });
    child.stdin.end(`${JSON.stringify(payload)}\n`);
  });
}

async function readState(statePath) {
  return JSON.parse(await readFile(statePath, "utf8"));
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label} expected ${JSON.stringify(expected)} but got ${JSON.stringify(actual)}`);
  }
}

function assertTruthy(value, label) {
  if (!value) throw new Error(`${label} was not truthy`);
}

export async function runSmoke() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "codex-bar-smoke-"));
  const statePath = path.join(dir, "state.json");
  const env = {
    CODEX_STATUS_BAR_HOME: dir,
    CODEX_STATUS_BAR_STATE: statePath,
  };
  const session = {
    session_id: "smoke-session",
    cwd: path.join(os.tmpdir(), "codex-bar-smoke-project"),
    model: "gpt-5.5",
  };

  try {
    await runHook("UserPromptSubmit", session, env);
    let state = await readState(statePath);
    assertEqual(state.current.status, "thinking", "prompt status");
    assertEqual(state.aggregate.runningSessions, 1, "running sessions after prompt");

    await runHook("PermissionRequest", {
      ...session,
      tool_name: "apply_patch",
    }, env);
    state = await readState(statePath);
    assertEqual(state.attention, "approval", "approval attention");
    assertEqual(state.headline, "1 approval needed", "approval headline");
    assertEqual(state.aggregate.approvalsRequired, 1, "approval count");
    assertEqual(state.sessions["smoke-session"].approvalRequired, true, "session approval flag");

    await runHook("PostToolUse", {
      ...session,
      tool_name: "update_plan",
      arguments: JSON.stringify({
        plan: [
          { step: "Build status rows", status: "completed" },
          { step: "Verify approval state", status: "completed" },
          { step: "Ship release", status: "in_progress" },
        ],
      }),
    }, env);
    state = await readState(statePath);
    assertEqual(state.attention, null, "attention after tool result");
    assertEqual(state.headline, "2/3 tasks", "progress headline");
    assertEqual(state.progress.done, 2, "progress done");
    assertEqual(state.progress.total, 3, "progress total");
    assertEqual(state.sessions["smoke-session"].approvalRequired, false, "approval cleared");

    await runHook("Stop", session, env);
    state = await readState(statePath);
    assertEqual(state.current.status, "completed", "completed status");
    assertEqual(state.headline, "1 completed", "completed headline");
    assertEqual(state.progress, null, "stale progress cleared");
    assertEqual(state.aggregate.completedSessions, 1, "completed sessions");
    assertTruthy(state.sessions["smoke-session"].completedAt, "completed timestamp");

    return {
      statePath,
      approvalHeadline: "1 approval needed",
      progressHeadline: "2/3 tasks",
      completedHeadline: "1 completed",
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function main() {
  const result = await runSmoke();
  console.log("Codex Bar state smoke passed");
  console.log(`approval: ${result.approvalHeadline}`);
  console.log(`progress: ${result.progressHeadline}`);
  console.log(`completed: ${result.completedHeadline}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
