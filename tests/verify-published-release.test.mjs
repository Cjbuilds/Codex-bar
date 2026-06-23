import assert from "node:assert/strict";
import test from "node:test";

import {
  assetUrls,
  parseArgs,
  parseChecksum,
  releaseName,
  verifyArchiveEntries,
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
    "--keep",
  ], {});

  assert.equal(options.repo, "owner/repo");
  assert.equal(options.tag, "v1.2.3");
  assert.equal(options.version, "1.2.3");
  assert.equal(options.arch, "x64");
  assert.equal(options.outputDir, "/tmp/release");
  assert.equal(options.keep, true);
});
