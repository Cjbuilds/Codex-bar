#!/usr/bin/env node
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_LIVE_TIMEOUT_MS = 15_000;
const DEFAULT_INTERVAL_MS = 1_000;

export function codexHome(env = process.env) {
  return path.resolve(env.CODEX_HOME || path.join(os.homedir(), ".codex"));
}

export function statusRoot(env = process.env) {
  if (env.CODEX_STATUS_BAR_HOME) return path.resolve(env.CODEX_STATUS_BAR_HOME);
  return path.join(codexHome(env), "statusbar");
}

export function appPath(env = process.env) {
  return env.CODEX_STATUS_BAR_APP || path.join(statusRoot(env), "Codex Bar.app");
}

export function processPatterns(installedApp) {
  return [
    path.join(installedApp, "Contents", "MacOS", "CodexStatusBar"),
    `${path.join(installedApp, "Contents", "Resources", "collector.mjs")} --watch`,
  ];
}

export function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    open: true,
    live: true,
    liveTimeoutMs: DEFAULT_LIVE_TIMEOUT_MS,
    intervalMs: DEFAULT_INTERVAL_MS,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const [key, inlineValue] = arg.split("=", 2);
    const nextValue = () => inlineValue ?? argv[++index];
    switch (key) {
      case "--no-open":
        options.open = false;
        break;
      case "--no-live":
        options.live = false;
        break;
      case "--live-timeout-ms":
        options.liveTimeoutMs = positiveNumber(nextValue(), key);
        break;
      case "--interval-ms":
        options.intervalMs = positiveNumber(nextValue(), key);
        break;
      default:
        throw new Error(`unknown option ${arg}`);
    }
  }

  if (options.intervalMs > options.liveTimeoutMs) {
    throw new Error("--interval-ms must be less than or equal to --live-timeout-ms");
  }
  return options;
}

function positiveNumber(value, label) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${label} must be a positive number`);
  return parsed;
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

async function runChecked(command, args, options = {}) {
  const result = await run(command, args, options);
  if (result.code !== 0) {
    const message = result.stderr.trim() || result.stdout.trim() || `exit ${result.code}`;
    throw new Error(`${command} ${args.join(" ")} failed: ${message}`);
  }
  return result;
}

async function waitForLiveDoctor(options, env = process.env) {
  const started = Date.now();
  let lastError = "not checked";
  while (Date.now() - started <= options.liveTimeoutMs) {
    const result = await run(process.execPath, ["scripts/doctor.mjs", "--live"], { env });
    if (result.code === 0) return result;
    lastError = result.stderr.trim() || result.stdout.trim() || `exit ${result.code}`;
    await sleep(options.intervalMs);
  }
  throw new Error(`Codex Bar did not become live within ${options.liveTimeoutMs}ms: ${lastError}`);
}

async function stopExistingApp(installedApp, options, env = process.env) {
  const patterns = processPatterns(installedApp);
  for (const pattern of patterns) {
    await run("/usr/bin/pkill", ["-f", pattern], { env });
  }

  const started = Date.now();
  while (Date.now() - started <= options.liveTimeoutMs) {
    const livePatterns = await Promise.all(patterns.map(async (pattern) => {
      const result = await run("/usr/bin/pgrep", ["-f", pattern], { env });
      return result.code === 0 && result.stdout.trim();
    }));
    if (livePatterns.every((value) => !value)) return;
    await sleep(Math.min(options.intervalMs, 250));
  }

  throw new Error("timed out waiting for the existing Codex Bar process to stop");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  if (process.platform !== "darwin") {
    throw new Error("Codex Bar local install currently supports macOS only");
  }

  const options = parseArgs(argv);
  const installedApp = appPath(env);

  if (options.open) {
    console.log("Stopping existing Codex Bar if running...");
    await stopExistingApp(installedApp, options, env);
  }

  console.log("Building Codex Bar app...");
  await runChecked(process.execPath, ["plugins/codex-status-bar/scripts/package-app.mjs"], {
    env,
    stdio: "inherit",
  });

  console.log("Checking installed bundle...");
  await runChecked(process.execPath, ["scripts/doctor.mjs"], {
    env,
    stdio: "inherit",
  });

  if (options.open) {
    console.log("Launching Codex Bar...");
    await runChecked("/usr/bin/open", ["-gj", installedApp], { env });
  }

  if (options.live) {
    console.log("Waiting for live app and collector...");
    const result = await waitForLiveDoctor(options, env);
    process.stdout.write(result.stdout);
  }

  console.log(`Codex Bar installed at ${installedApp}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
