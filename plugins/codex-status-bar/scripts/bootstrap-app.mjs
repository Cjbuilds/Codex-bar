#!/usr/bin/env node
import { constants as fsConstants } from "node:fs";
import { access, mkdir, open, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";

const BOOTSTRAP_LOCK_TIMEOUT_MS = 1000;
const BOOTSTRAP_LOCK_STALE_MS = 120000;

function statusRoot(env = process.env) {
  if (env.CODEX_STATUS_BAR_HOME) return path.resolve(env.CODEX_STATUS_BAR_HOME);
  return path.join(os.homedir(), ".codex", "statusbar");
}

function pluginRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function sourceStamp(root) {
  const files = [
    "app/Package.swift",
    "app/Sources/CodexStatusBar/main.swift",
    "app/Sources/CodexStatusBarCore/StatusModels.swift",
    "app/Sources/CodexStatusBarCore/StatusFormatter.swift",
    "scripts/collector.mjs",
  ];
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file);
    hash.update(await readFile(path.join(root, file)));
  }
  return hash.digest("hex");
}

async function run(command, args, options = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: options.stdio || "ignore" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited ${code}`));
    });
  });
}

async function launch(appPath) {
  await run("/usr/bin/open", ["-gj", appPath]);
}

async function buildIfNeeded(root, appPath) {
  const stampPath = path.join(path.dirname(appPath), "source.stamp");
  const exePath = path.join(appPath, "Contents", "MacOS", "CodexStatusBar");
  const nextStamp = await sourceStamp(root);
  const previousStamp = (await readFile(stampPath, "utf8").catch(() => "")).trim();
  if ((await exists(exePath)) && previousStamp === nextStamp) return;

  await run(process.execPath, [path.join(root, "scripts", "package-app.mjs")], {
    env: { ...process.env, CODEX_STATUS_BAR_APP: appPath },
  });
  await writeFile(stampPath, `${nextStamp}\n`, { mode: 0o600 });
}

async function withBootstrapLock(rootDir, fn) {
  await mkdir(rootDir, { recursive: true, mode: 0o700 });
  const lockPath = path.join(rootDir, "bootstrap.lock");
  const started = Date.now();
  while (Date.now() - started <= BOOTSTRAP_LOCK_TIMEOUT_MS) {
    let handle = null;
    try {
      handle = await open(lockPath, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_RDWR, 0o600);
      await handle.writeFile(String(process.pid));
      try {
        return await fn();
      } finally {
        await handle.close();
        await rm(lockPath, { force: true });
      }
    } catch (error) {
      if (handle) await handle.close().catch(() => {});
      if (error.code !== "EEXIST") throw error;
      await removeStaleLock(lockPath);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}

async function removeStaleLock(lockPath) {
  try {
    const info = await stat(lockPath);
    if (Date.now() - info.mtimeMs > BOOTSTRAP_LOCK_STALE_MS) await rm(lockPath, { force: true });
  } catch {
    // Lock disappeared.
  }
}

export async function main() {
  if (process.platform !== "darwin") return;
  const root = pluginRoot();
  const rootDir = statusRoot();
  const appPath = process.env.CODEX_STATUS_BAR_APP || path.join(rootDir, "Codex Bar.app");
  await withBootstrapLock(rootDir, async () => {
    await buildIfNeeded(root, appPath);
    await launch(appPath);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    const logPath = path.join(statusRoot(), "bootstrap-error.log");
    mkdir(path.dirname(logPath), { recursive: true, mode: 0o700 })
      .then(() => writeFile(logPath, `${new Date().toISOString()} ${error.stack || error.message}\n`, { flag: "a", mode: 0o600 }))
      .finally(() => {
        process.exitCode = 1;
      });
  });
}
