#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { auditStateObject } from "./audit-privacy.mjs";
import { appPath, processPatterns } from "./install-local.mjs";

const DEFAULT_PHASE_MS = 4_000;
const DEFAULT_SETTLE_MS = 1_200;

export function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    phaseMs: DEFAULT_PHASE_MS,
    settleMs: DEFAULT_SETTLE_MS,
    restartNormalApp: true,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const [key, inlineValue] = arg.split("=", 2);
    const nextValue = () => inlineValue ?? argv[++index];
    switch (key) {
      case "--phase-ms":
        options.phaseMs = positiveNumber(nextValue(), key);
        break;
      case "--settle-ms":
        options.settleMs = positiveNumber(nextValue(), key);
        break;
      case "--no-restart":
        options.restartNormalApp = false;
        break;
      default:
        throw new Error(`unknown option ${arg}`);
    }
  }

  return options;
}

function positiveNumber(value, label) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${label} must be a positive number`);
  return parsed;
}

export function demoStates(now = new Date()) {
  const startedAt = new Date(now.getTime() - 7 * 60 * 1000).toISOString();
  const turnStartedAt = new Date(now.getTime() - 2 * 60 * 1000).toISOString();
  const updatedAt = now.toISOString();
  const baseSession = {
    id: "demo-codex-status-bar",
    threadId: "demo-codex-status-bar",
    shortId: "demo",
    displayName: "Codex 1",
    label: "Build Codex status bar",
    labelSource: "demo",
    openURL: null,
    cwd: path.join(os.homedir(), "Documents", "Fix things"),
    project: "Fix things",
    model: "gpt-5",
    startedAt,
    updatedAt,
    lastActivityAt: updatedAt,
    completedAt: null,
    currentTurnStartedAt: turnStartedAt,
    currentTool: "editing files",
    lastEvent: "PermissionRequest",
    approvalRequired: true,
    turnsStarted: 1,
    turnsCompleted: 0,
    toolCallsStarted: 3,
    toolCallsCompleted: 2,
    progress: {
      label: "tasks",
      done: 2,
      total: 3,
      source: "demo",
      items: [
        { step: "Read Codex session title", status: "completed" },
        { step: "Render menu status", status: "completed" },
        { step: "Wait for approval", status: "in_progress" },
      ],
    },
    goal: {
      status: "active",
      tokenBudget: null,
      tokensUsed: 1200,
      timeUsedSeconds: 420,
      createdAt: startedAt,
      updatedAt,
    },
    stale: false,
  };

  return [
    {
      label: "approval",
      state: makeState({
        nowIso: updatedAt,
        attention: "approval",
        headline: "1 waiting",
        detail: "Codex 1 waiting for approval",
        current: {
          status: "approval",
          event: "PermissionRequest",
          toolName: "editing files",
          startedAt: updatedAt,
        },
        aggregate: {
          runningSessions: 1,
          completedSessions: 0,
          approvalsRequired: 1,
          totalToolCalls: 2,
          activeSince: turnStartedAt,
        },
        progress: baseSession.progress,
        session: {
          ...baseSession,
          status: "approval",
        },
      }),
    },
    {
      label: "progress",
      state: makeState({
        nowIso: updatedAt,
        attention: null,
        headline: "2/3 tasks",
        detail: "Codex 1 2/3 tasks",
        current: {
          status: "running",
          event: "function_call",
          toolName: "terminal",
          startedAt: updatedAt,
        },
        aggregate: {
          runningSessions: 1,
          completedSessions: 0,
          approvalsRequired: 0,
          totalToolCalls: 3,
          activeSince: turnStartedAt,
        },
        progress: baseSession.progress,
        session: {
          ...baseSession,
          status: "running",
          currentTool: "terminal",
          lastEvent: "function_call",
          approvalRequired: false,
          toolCallsCompleted: 3,
        },
      }),
    },
    {
      label: "completed",
      state: makeState({
        nowIso: updatedAt,
        attention: null,
        headline: "1 completed",
        detail: "Codex 1 completed",
        current: {
          status: "completed",
          event: "Stop",
          toolName: null,
          startedAt: updatedAt,
        },
        aggregate: {
          runningSessions: 0,
          completedSessions: 1,
          approvalsRequired: 0,
          totalToolCalls: 3,
          activeSince: null,
        },
        progress: null,
        session: {
          ...baseSession,
          status: "completed",
          currentTool: null,
          lastEvent: "Stop",
          approvalRequired: false,
          turnsCompleted: 1,
          progress: null,
          goal: { ...baseSession.goal, status: "complete" },
          completedAt: updatedAt,
        },
      }),
    },
  ];
}

function makeState({ nowIso, attention, headline, detail, current, progress, aggregate, session }) {
  return {
    version: 1,
    installId: "demo-install",
    updatedAt: nowIso,
    attention,
    headline,
    detail,
    current,
    progress,
    aggregate,
    sessions: {
      [session.id]: session,
    },
  };
}

async function writeDemoState(statePath, state) {
  const findings = auditStateObject(state);
  if (findings.length > 0) {
    throw new Error(`demo state failed privacy audit:\n${findings.join("\n")}`);
  }
  await mkdir(path.dirname(statePath), { recursive: true, mode: 0o700 });
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}

async function pgrep(pattern) {
  const result = await run("/usr/bin/pgrep", ["-f", pattern]);
  return result.code === 0 && result.stdout.trim() ? result.stdout.trim().split(/\s+/).filter(Boolean) : [];
}

async function stopPatterns(patterns) {
  for (const pattern of patterns) {
    await run("/usr/bin/pkill", ["-f", pattern]);
  }
}

async function wasRunning(patterns) {
  const matches = await Promise.all(patterns.map((pattern) => pgrep(pattern)));
  return matches.some((items) => items.length > 0);
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function launchDemoApp(installedApp, statePath, settleMs, env = process.env) {
  const executable = path.join(installedApp, "Contents", "MacOS", "CodexStatusBar");
  const child = spawn(executable, [], {
    env: {
      ...env,
      CODEX_STATUS_BAR_STATE: statePath,
      CODEX_STATUS_BAR_DISABLE_COLLECTOR: "1",
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });
  await sleep(settleMs);
  if (child.exitCode !== null) {
    throw new Error(`demo app exited early: ${stderr.trim() || `exit ${child.exitCode}`}`);
  }
  return child;
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  const exited = await Promise.race([
    new Promise((resolve) => child.once("exit", () => resolve(true))),
    sleep(2_000).then(() => false),
  ]);
  if (!exited && child.exitCode === null) child.kill("SIGKILL");
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  if (process.platform !== "darwin") {
    throw new Error("Codex Bar live demo currently supports macOS only");
  }

  const options = parseArgs(argv);
  const installedApp = appPath(env);
  const patterns = processPatterns(installedApp);
  const normalWasRunning = await wasRunning(patterns);
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "codex-bar-live-demo-"));
  const statePath = path.join(tempRoot, "state.json");
  const phases = demoStates();
  let demoApp = null;

  try {
    console.log("Stopping the normal Codex Bar app for the demo...");
    await stopPatterns(patterns);

    console.log("Launching demo Codex Bar with a temporary state file...");
    await writeDemoState(statePath, phases[0].state);
    demoApp = await launchDemoApp(installedApp, statePath, options.settleMs, env);

    for (const phase of phases) {
      await writeDemoState(statePath, phase.state);
      console.log(`Showing ${phase.label}: ${phase.state.headline}`);
      await sleep(options.phaseMs);
    }

    console.log("Codex Bar live demo completed");
  } finally {
    await stopChild(demoApp);
    await rm(tempRoot, { recursive: true, force: true });
    await stopPatterns(patterns);
    if (normalWasRunning && options.restartNormalApp) {
      console.log("Restoring normal Codex Bar app...");
      await run("/usr/bin/open", ["-gj", installedApp], { env });
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
