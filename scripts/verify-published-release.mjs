#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_REPO = "Cjbuilds/Codex-bar";

export function releaseName({ version, platform = process.platform, arch = process.arch }) {
  const platformName = platform === "darwin" ? "macos" : platform;
  return `codex-bar-v${version}-${platformName}-${arch}`;
}

export function assetUrls({ repo = DEFAULT_REPO, tag, name }) {
  if (!repo || !tag || !name) throw new Error("repo, tag, and name are required");
  const base = `https://github.com/${repo}/releases/download/${encodeURIComponent(tag)}`;
  return {
    zip: `${base}/${encodeURIComponent(`${name}.zip`)}`,
    checksum: `${base}/${encodeURIComponent(`${name}.zip.sha256`)}`,
  };
}

export function parseChecksum(text, expectedFileName) {
  const line = text.split(/\r?\n/).map((item) => item.trim()).find(Boolean);
  const match = line?.match(/^([a-f0-9]{64})\s+\*?(.+)$/i);
  if (!match) throw new Error("checksum file did not contain a valid SHA-256 line");
  const [, checksum, fileName] = match;
  if (fileName !== expectedFileName) {
    throw new Error(`checksum file references ${JSON.stringify(fileName)} instead of ${JSON.stringify(expectedFileName)}`);
  }
  return checksum.toLowerCase();
}

export function verifyArchiveEntries(entries) {
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

export function parseArgs(argv = process.argv.slice(2), env = process.env) {
  const options = {
    repo: env.CODEX_BAR_RELEASE_REPO || DEFAULT_REPO,
    tag: env.RELEASE_TAG || null,
    version: null,
    arch: env.CODEX_STATUS_BAR_RELEASE_ARCH || process.arch,
    outputDir: null,
    keep: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const [key, inlineValue] = arg.split("=", 2);
    const nextValue = () => inlineValue ?? argv[++index];
    switch (key) {
      case "--repo":
        options.repo = nextValue();
        break;
      case "--tag":
        options.tag = nextValue();
        break;
      case "--version":
        options.version = nextValue();
        break;
      case "--arch":
        options.arch = nextValue();
        break;
      case "--output-dir":
        options.outputDir = path.resolve(nextValue());
        break;
      case "--keep":
        options.keep = true;
        break;
      default:
        throw new Error(`unknown option ${arg}`);
    }
  }

  return options;
}

async function downloadFile(url, targetPath) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`download failed for ${url}: HTTP ${response.status}`);
  const body = Buffer.from(await response.arrayBuffer());
  await writeFile(targetPath, body);
}

async function sha256(filePath) {
  const body = await readFile(filePath);
  return createHash("sha256").update(body).digest("hex");
}

async function zipEntries(filePath) {
  const stdout = await capture("/usr/bin/unzip", ["-Z", "-1", filePath]);
  return stdout.split(/\r?\n/).filter(Boolean);
}

async function capture(command, args) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
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

export async function main(argv = process.argv.slice(2), env = process.env) {
  const options = parseArgs(argv, env);
  const packageJson = JSON.parse(await readFile(path.join(process.cwd(), "package.json"), "utf8"));
  const version = options.version || packageJson.version;
  const tag = options.tag || `v${version}`;
  const name = releaseName({ version, arch: options.arch });
  const urls = assetUrls({ repo: options.repo, tag, name });
  const workDir = options.outputDir || await mkdtemp(path.join(os.tmpdir(), "codex-bar-release-download-"));
  const zipPath = path.join(workDir, `${name}.zip`);
  const checksumPath = `${zipPath}.sha256`;

  try {
    await downloadFile(urls.zip, zipPath);
    await downloadFile(urls.checksum, checksumPath);

    const expectedChecksum = parseChecksum(await readFile(checksumPath, "utf8"), path.basename(zipPath));
    const actualChecksum = await sha256(zipPath);
    if (actualChecksum !== expectedChecksum) {
      throw new Error(`checksum mismatch: expected ${expectedChecksum}, got ${actualChecksum}`);
    }

    verifyArchiveEntries(await zipEntries(zipPath));
    const zipInfo = await stat(zipPath);
    console.log(`Published release verified: ${options.repo} ${tag}`);
    console.log(`Asset: ${path.basename(zipPath)}`);
    console.log(`SHA-256: ${actualChecksum}`);
    console.log(`Size: ${zipInfo.size} bytes`);
  } finally {
    if (!options.outputDir && !options.keep) {
      await rm(workDir, { recursive: true, force: true });
    } else if (options.keep) {
      console.log(`Kept downloaded assets in ${workDir}`);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
