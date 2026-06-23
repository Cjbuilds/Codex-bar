import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  assetUrls,
  parseArgs,
  parseChecksum,
  parsePlistStringValue,
  releaseName,
  verifyArchiveEntries,
  verifyExtractedApp,
} from "../scripts/verify-published-release.mjs";

test("releaseName uses macOS release naming", () => {
  assert.equal(
    releaseName({ version: "0.1.0", platform: "darwin", arch: "arm64" }),
    "codex-bar-v0.1.0-macos-arm64"
  );
  assert.equal(
    releaseName({ version: "0.1.0", platform: "linux", arch: "x64" }),
    "codex-bar-v0.1.0-linux-x64"
  );
});

test("assetUrls builds GitHub release download URLs", () => {
  assert.deepEqual(assetUrls({
    repo: "Cjbuilds/Codex-bar",
    tag: "v0.1.0",
    name: "codex-bar-v0.1.0-macos-arm64",
  }), {
    zip: "https://github.com/Cjbuilds/Codex-bar/releases/download/v0.1.0/codex-bar-v0.1.0-macos-arm64.zip",
    checksum: "https://github.com/Cjbuilds/Codex-bar/releases/download/v0.1.0/codex-bar-v0.1.0-macos-arm64.zip.sha256",
  });
});

test("parseChecksum accepts shasum format and rejects wrong filenames", () => {
  const checksum = "10ddcd243a0f07b8b51c089951568d248e4de0944ac3a2413b341b2ea8d428d3";

  assert.equal(parseChecksum(`${checksum}  codex-bar.zip\n`, "codex-bar.zip"), checksum);
  assert.throws(
    () => parseChecksum(`${checksum}  other.zip\n`, "codex-bar.zip"),
    /instead of/
  );
  assert.throws(() => parseChecksum("not a checksum", "codex-bar.zip"), /valid SHA-256/);
});

test("verifyArchiveEntries requires app files and rejects AppleDouble metadata", () => {
  const entries = [
    "Codex Bar.app/Contents/MacOS/CodexStatusBar",
    "Codex Bar.app/Contents/Resources/collector.mjs",
    "Codex Bar.app/Contents/Info.plist",
  ];

  assert.doesNotThrow(() => verifyArchiveEntries(entries));
  assert.throws(() => verifyArchiveEntries(entries.slice(1)), /missing/);
  assert.throws(() => verifyArchiveEntries([...entries, "Codex Bar.app/Contents/._Info.plist"]), /AppleDouble/);
});

test("parseArgs supports release verification options", () => {
  const options = parseArgs([
    "--repo", "owner/repo",
    "--tag=v1.2.3",
    "--version", "1.2.3",
    "--arch", "x64",
    "--output-dir", "/tmp/release",
    "--install-smoke",
    "--keep",
  ], {});

  assert.equal(options.repo, "owner/repo");
  assert.equal(options.tag, "v1.2.3");
  assert.equal(options.version, "1.2.3");
  assert.equal(options.arch, "x64");
  assert.equal(options.outputDir, "/tmp/release");
  assert.equal(options.installSmoke, true);
  assert.equal(options.keep, true);
});

test("parsePlistStringValue reads app version strings", () => {
  const plist = `
<plist version="1.0">
<dict>
  <key>CFBundleShortVersionString</key>
  <string>1.2.3</string>
</dict>
</plist>`;

  assert.equal(parsePlistStringValue(plist, "CFBundleShortVersionString"), "1.2.3");
  assert.throws(() => parsePlistStringValue(plist, "MissingKey"), /missing/);
});

test("verifyExtractedApp validates install-ready app bundles", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "codex-bar-extracted-app-"));
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  const appPath = path.join(dir, "Codex Bar.app");
  const executablePath = path.join(appPath, "Contents", "MacOS", "CodexStatusBar");
  const collectorPath = path.join(appPath, "Contents", "Resources", "collector.mjs");
  const plistPath = path.join(appPath, "Contents", "Info.plist");
  await mkdir(path.dirname(executablePath), { recursive: true });
  await mkdir(path.dirname(collectorPath), { recursive: true });
  await writeFile(executablePath, "#!/bin/sh\n".padEnd(10_001, "x"));
  await chmod(executablePath, 0o755);
  await writeFile(collectorPath, "const file = 'session_index.jsonl'; function readCodexThreadTitles() {}\n");
  await writeFile(plistPath, [
    "<plist version=\"1.0\">",
    "<dict>",
    "<key>CFBundleShortVersionString</key>",
    "<string>1.2.3</string>",
    "</dict>",
    "</plist>",
  ].join("\n"));

  const calls = [];
  const result = await verifyExtractedApp({
    appPath,
    version: "1.2.3",
    commandRunner: async (command, args) => {
      calls.push([command, args]);
      return "";
    },
  });

  assert.equal(result.version, "1.2.3");
  assert.equal(result.executableSize, 10_001);
  if (process.platform === "darwin") {
    assert.equal(calls[0][0], "/usr/bin/codesign");
  } else {
    assert.equal(calls.length, 0);
  }
});

test("verifyExtractedApp rejects stale collectors", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "codex-bar-stale-app-"));
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  const appPath = path.join(dir, "Codex Bar.app");
  await mkdir(path.join(appPath, "Contents", "MacOS"), { recursive: true });
  await mkdir(path.join(appPath, "Contents", "Resources"), { recursive: true });
  const executablePath = path.join(appPath, "Contents", "MacOS", "CodexStatusBar");
  await writeFile(executablePath, "#!/bin/sh\n".padEnd(10_001, "x"));
  await chmod(executablePath, 0o755);
  await writeFile(path.join(appPath, "Contents", "Resources", "collector.mjs"), "const file = 'state_5.sqlite';\n");
  await writeFile(path.join(appPath, "Contents", "Info.plist"), [
    "<plist version=\"1.0\">",
    "<dict>",
    "<key>CFBundleShortVersionString</key>",
    "<string>1.2.3</string>",
    "</dict>",
    "</plist>",
  ].join("\n"));

  await assert.rejects(
    () => verifyExtractedApp({ appPath, version: "1.2.3", commandRunner: async () => "" }),
    /session-index title support/
  );
});
