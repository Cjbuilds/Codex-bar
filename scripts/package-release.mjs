#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const packageJson = JSON.parse(await readFile(path.join(ROOT, "package.json"), "utf8"));
const platformName = process.platform === "darwin" ? "macos" : process.platform;
const archName = process.env.CODEX_STATUS_BAR_RELEASE_ARCH || process.arch;
const releaseName = `codex-bar-v${packageJson.version}-${platformName}-${archName}`;
const distDir = path.join(ROOT, "dist");
const stageDir = path.join(distDir, "stage", releaseName);
const appPath = path.join(stageDir, "Codex Bar.app");
const zipPath = path.join(distDir, `${releaseName}.zip`);
const checksumPath = `${zipPath}.sha256`;

async function run(command, args, options = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: options.stdio || "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited ${code}`));
    });
  });
}

async function capture(command, args, options = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${command} ${args.join(" ")} exited ${code}: ${stderr.trim()}`));
    });
  });
}

async function sha256(filePath) {
  const body = await readFile(filePath);
  return createHash("sha256").update(body).digest("hex");
}

async function verifyArchive(filePath) {
  const entries = (await capture("/usr/bin/unzip", ["-Z", "-1", filePath]))
    .split("\n")
    .filter(Boolean);
  const requiredEntries = [
    "Codex Bar.app/Contents/MacOS/CodexStatusBar",
    "Codex Bar.app/Contents/Resources/collector.mjs",
    "Codex Bar.app/Contents/Info.plist",
  ];
  for (const entry of requiredEntries) {
    if (!entries.includes(entry)) throw new Error(`release zip is missing ${entry}`);
  }
  const appleDouble = entries.find((entry) => path.basename(entry).startsWith("._"));
  if (appleDouble) throw new Error(`release zip contains macOS AppleDouble metadata: ${appleDouble}`);
}

if (process.platform !== "darwin") {
  throw new Error("Codex Bar release packaging currently supports macOS only");
}

await mkdir(distDir, { recursive: true });
await rm(stageDir, { recursive: true, force: true });
await rm(zipPath, { force: true });
await rm(checksumPath, { force: true });
await mkdir(stageDir, { recursive: true });

await run(process.execPath, ["plugins/codex-status-bar/scripts/package-app.mjs"], {
  cwd: ROOT,
  env: { ...process.env, CODEX_STATUS_BAR_APP: appPath },
});

await run(process.execPath, ["scripts/doctor.mjs"], {
  cwd: ROOT,
  env: { ...process.env, CODEX_STATUS_BAR_APP: appPath },
});

await run("/usr/bin/ditto", ["-c", "-k", "--norsrc", "--keepParent", "Codex Bar.app", zipPath], {
  cwd: stageDir,
  env: { ...process.env, COPYFILE_DISABLE: "1" },
});

await verifyArchive(zipPath);

const [checksum, zipInfo] = await Promise.all([sha256(zipPath), stat(zipPath)]);
await writeFile(checksumPath, `${checksum}  ${path.basename(zipPath)}\n`);

console.log(`Release artifact: ${zipPath}`);
console.log(`SHA-256: ${checksum}`);
console.log(`Size: ${zipInfo.size} bytes`);
