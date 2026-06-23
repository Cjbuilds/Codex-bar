#!/usr/bin/env node
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(scriptDir, "..");
const packagePath = path.join(pluginRoot, "app");
const statusRoot = process.env.CODEX_STATUS_BAR_HOME
  ? path.resolve(process.env.CODEX_STATUS_BAR_HOME)
  : path.join(os.homedir(), ".codex", "statusbar");
const appPath = process.env.CODEX_STATUS_BAR_APP || path.join(statusRoot, "Codex Bar.app");

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

function plist() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleExecutable</key>
  <string>CodexStatusBar</string>
  <key>CFBundleIdentifier</key>
  <string>dev.codexbar.CodexBar</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>Codex Bar</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>0.1.0</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>LSMinimumSystemVersion</key>
  <string>13.0</string>
  <key>LSUIElement</key>
  <true/>
  <key>NSHumanReadableCopyright</key>
  <string>MIT</string>
</dict>
</plist>
`;
}

export async function main() {
  if (process.platform !== "darwin") {
    throw new Error("Codex Bar app packaging currently supports macOS only");
  }

  await run("/usr/bin/env", ["swift", "build", "-c", "release", "--package-path", packagePath]);

  const executable = path.join(packagePath, ".build", "release", "CodexStatusBar");
  const contents = path.join(appPath, "Contents");
  const macos = path.join(contents, "MacOS");
  const resources = path.join(contents, "Resources");

  await rm(appPath, { recursive: true, force: true });
  await mkdir(macos, { recursive: true, mode: 0o755 });
  await mkdir(resources, { recursive: true, mode: 0o755 });
  await cp(executable, path.join(macos, "CodexStatusBar"));
  await cp(path.join(scriptDir, "collector.mjs"), path.join(resources, "collector.mjs"));
  await writeFile(path.join(contents, "Info.plist"), plist());
  await writeFile(path.join(resources, "README.txt"), "Codex Bar is managed by the codex-status-bar plugin.\n");

  await run("/usr/bin/codesign", ["--force", "--sign", "-", appPath]).catch(() => {});
  console.log(appPath);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
