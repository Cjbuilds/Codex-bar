#!/usr/bin/env node
import { constants as fsConstants } from "node:fs";
import { access, readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";

const ROOT = process.cwd();
const live = process.argv.includes("--live");
const statusRoot = process.env.CODEX_STATUS_BAR_HOME
  ? path.resolve(process.env.CODEX_STATUS_BAR_HOME)
  : path.join(os.homedir(), ".codex", "statusbar");
const appPath = process.env.CODEX_STATUS_BAR_APP || path.join(statusRoot, "Codex Bar.app");
const statePath = process.env.CODEX_STATUS_BAR_STATE || path.join(statusRoot, "state.json");
const appExecutable = path.join(appPath, "Contents", "MacOS", "CodexStatusBar");
const bundledCollector = path.join(appPath, "Contents", "Resources", "collector.mjs");
const repoCollector = path.join(ROOT, "plugins", "codex-status-bar", "scripts", "collector.mjs");
const manifestPath = path.join(ROOT, "plugins", "codex-status-bar", ".codex-plugin", "plugin.json");

const failures = [];
const warnings = [];

function fail(message) {
  failures.push(message);
}

function warn(message) {
  warnings.push(message);
}

async function exists(filePath, label, mode = fsConstants.R_OK) {
  try {
    await access(filePath, mode);
    return true;
  } catch {
    fail(`${label} is missing or inaccessible at ${filePath}`);
    return false;
  }
}

async function sha256(filePath) {
  const body = await readFile(filePath);
  return createHash("sha256").update(body).digest("hex");
}

async function compareCollectors() {
  if (!(await exists(repoCollector, "repo collector"))) return;
  if (!(await exists(bundledCollector, "bundled collector"))) return;
  const [repoHash, bundledHash] = await Promise.all([
    sha256(repoCollector),
    sha256(bundledCollector),
  ]);
  if (repoHash !== bundledHash) {
    fail("bundled collector does not match repo collector; run npm run build:app");
  }
}

async function checkCodesign() {
  if (process.platform !== "darwin") {
    warn("codesign verification skipped because this is not macOS");
    return;
  }
  const result = await run("/usr/bin/codesign", ["--verify", "--deep", "--strict", appPath]);
  if (result.code !== 0) fail(`codesign verification failed: ${result.stderr.trim() || result.stdout.trim()}`);
}

async function checkLive() {
  if (process.platform !== "darwin") {
    warn("live process check skipped because this is not macOS");
    return;
  }
  const appProcess = await pgrep(appExecutable);
  if (!appProcess) fail("Codex Bar app process is not running");

  const collectorProcess = await pgrep(`${bundledCollector} --watch`);
  if (!collectorProcess) fail("Codex Bar collector process is not running");

  try {
    const parsed = JSON.parse(await readFile(statePath, "utf8"));
    if (parsed.version !== 1) fail("state.json does not contain version 1 state");
    if (!parsed.sessions || typeof parsed.sessions !== "object") fail("state.json does not contain a sessions object");
    const count = parsed.sessions && typeof parsed.sessions === "object" ? Object.keys(parsed.sessions).length : 0;
    console.log(`Live state: ${count} session${count === 1 ? "" : "s"}, headline ${JSON.stringify(parsed.headline || "")}`);
  } catch (error) {
    fail(`state.json is not readable JSON at ${statePath}: ${error.message}`);
  }
}

async function pgrep(pattern) {
  const result = await run("/usr/bin/pgrep", ["-f", pattern]);
  return result.code === 0 && result.stdout.trim() ? result.stdout.trim() : null;
}

async function run(command, args) {
  return await new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("error", (error) => resolve({ code: 127, stdout, stderr: error.message }));
    child.on("exit", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

await exists(manifestPath, "plugin manifest");
await exists(appPath, "Codex Bar app bundle");
await exists(appExecutable, "Codex Bar app executable", fsConstants.X_OK);
await exists(bundledCollector, "bundled collector");
await compareCollectors();
await checkCodesign();

const appInfo = await stat(appExecutable).catch(() => null);
if (appInfo && appInfo.size < 10_000) fail("Codex Bar executable is unexpectedly small");

if (live) await checkLive();

for (const message of warnings) console.warn(`Warning: ${message}`);

if (failures.length > 0) {
  console.error("Codex Bar doctor failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(live ? "Codex Bar live doctor passed" : "Codex Bar doctor passed");
}
