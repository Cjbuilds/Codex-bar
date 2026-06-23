#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();

export function truthy(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").toLowerCase());
}

export function releaseLayout({ version, platform = process.platform, arch = process.arch, root = ROOT }) {
  const platformName = platform === "darwin" ? "macos" : platform;
  const releaseName = `codex-bar-v${version}-${platformName}-${arch}`;
  const distDir = path.join(root, "dist");
  const stageDir = path.join(distDir, "stage", releaseName);
  const appPath = path.join(stageDir, "Codex Bar.app");
  const zipPath = path.join(distDir, `${releaseName}.zip`);
  return {
    platformName,
    archName: arch,
    releaseName,
    distDir,
    stageDir,
    appPath,
    zipPath,
    checksumPath: `${zipPath}.sha256`,
  };
}

export function releaseSigningConfig(env = process.env) {
  const identity = env.CODEX_STATUS_BAR_SIGN_IDENTITY || "-";
  const notarize = truthy(env.CODEX_STATUS_BAR_NOTARIZE);
  if (notarize && identity === "-") {
    throw new Error("CODEX_STATUS_BAR_NOTARIZE=1 requires CODEX_STATUS_BAR_SIGN_IDENTITY with a Developer ID Application identity");
  }
  return {
    identity,
    notarize,
    requireSigning: identity !== "-" || notarize || truthy(env.CODEX_STATUS_BAR_REQUIRE_SIGNING),
    hardenedRuntime: identity !== "-" || notarize || truthy(env.CODEX_STATUS_BAR_HARDENED_RUNTIME),
  };
}

export function notarySubmitArgs({ archivePath, env = process.env }) {
  const timeout = env.CODEX_STATUS_BAR_NOTARY_TIMEOUT || "30m";
  const args = ["notarytool", "submit", archivePath, "--wait", "--timeout", timeout];

  if (env.CODEX_STATUS_BAR_NOTARY_PROFILE) {
    args.push("--keychain-profile", env.CODEX_STATUS_BAR_NOTARY_PROFILE);
    if (env.CODEX_STATUS_BAR_NOTARY_KEYCHAIN) {
      args.push("--keychain", env.CODEX_STATUS_BAR_NOTARY_KEYCHAIN);
    }
    return args;
  }

  if (env.CODEX_STATUS_BAR_NOTARY_KEY && env.CODEX_STATUS_BAR_NOTARY_KEY_ID) {
    args.push(
      "--key", env.CODEX_STATUS_BAR_NOTARY_KEY,
      "--key-id", env.CODEX_STATUS_BAR_NOTARY_KEY_ID
    );
    if (env.CODEX_STATUS_BAR_NOTARY_ISSUER) {
      args.push("--issuer", env.CODEX_STATUS_BAR_NOTARY_ISSUER);
    }
    return args;
  }

  if (env.CODEX_STATUS_BAR_NOTARY_APPLE_ID && env.CODEX_STATUS_BAR_NOTARY_PASSWORD && env.CODEX_STATUS_BAR_NOTARY_TEAM_ID) {
    args.push(
      "--apple-id", env.CODEX_STATUS_BAR_NOTARY_APPLE_ID,
      "--password", env.CODEX_STATUS_BAR_NOTARY_PASSWORD,
      "--team-id", env.CODEX_STATUS_BAR_NOTARY_TEAM_ID
    );
    return args;
  }

  throw new Error("notarization requires CODEX_STATUS_BAR_NOTARY_PROFILE, App Store Connect API key env vars, or Apple ID/app-password/team-id env vars");
}

export function redactedCommand(command, args, secrets = []) {
  const sensitive = new Set(secrets.filter(Boolean).map(String));
  const renderedArgs = args.map((arg) => sensitive.has(String(arg)) ? "<redacted>" : arg);
  return `${command} ${renderedArgs.join(" ")}`;
}

function notarySecretValues(env) {
  return [
    env.CODEX_STATUS_BAR_NOTARY_PASSWORD,
  ];
}

async function run(command, args, options = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: options.stdio || "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${redactedCommand(command, args, options.redact)} exited ${code}`));
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

async function createZip({ stageDir, zipPath }) {
  await rm(zipPath, { force: true });
  await run("/usr/bin/ditto", ["-c", "-k", "--norsrc", "--keepParent", "Codex Bar.app", zipPath], {
    cwd: stageDir,
    env: { ...process.env, COPYFILE_DISABLE: "1" },
  });
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

async function notarizeAndStaple({ appPath, zipPath, env }) {
  await run("/usr/bin/xcrun", notarySubmitArgs({ archivePath: zipPath, env }), {
    redact: notarySecretValues(env),
  });
  await run("/usr/bin/xcrun", ["stapler", "staple", appPath]);
  await run("/usr/bin/xcrun", ["stapler", "validate", appPath]);
}

export async function packageRelease({ env = process.env, root = ROOT } = {}) {
  if (process.platform !== "darwin") {
    throw new Error("Codex Bar release packaging currently supports macOS only");
  }

  const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  const layout = releaseLayout({
    version: packageJson.version,
    arch: env.CODEX_STATUS_BAR_RELEASE_ARCH || process.arch,
    root,
  });
  const signing = releaseSigningConfig(env);
  const packageEnv = {
    ...env,
    CODEX_STATUS_BAR_APP: layout.appPath,
    CODEX_STATUS_BAR_SIGN_IDENTITY: signing.identity,
    CODEX_STATUS_BAR_REQUIRE_SIGNING: signing.requireSigning ? "1" : "0",
    CODEX_STATUS_BAR_HARDENED_RUNTIME: signing.hardenedRuntime ? "1" : "0",
  };

  await mkdir(layout.distDir, { recursive: true });
  await rm(layout.stageDir, { recursive: true, force: true });
  await rm(layout.zipPath, { force: true });
  await rm(layout.checksumPath, { force: true });
  await mkdir(layout.stageDir, { recursive: true });

  await run(process.execPath, ["plugins/codex-status-bar/scripts/package-app.mjs"], {
    cwd: root,
    env: packageEnv,
  });

  await run(process.execPath, ["scripts/doctor.mjs"], {
    cwd: root,
    env: { ...env, CODEX_STATUS_BAR_APP: layout.appPath },
  });

  await createZip(layout);
  if (signing.notarize) {
    await notarizeAndStaple({ appPath: layout.appPath, zipPath: layout.zipPath, env });
    await createZip(layout);
  }

  await verifyArchive(layout.zipPath);

  const [checksum, zipInfo] = await Promise.all([sha256(layout.zipPath), stat(layout.zipPath)]);
  await writeFile(layout.checksumPath, `${checksum}  ${path.basename(layout.zipPath)}\n`);

  console.log(`Release artifact: ${layout.zipPath}`);
  console.log(`SHA-256: ${checksum}`);
  console.log(`Size: ${zipInfo.size} bytes`);
  if (signing.notarize) {
    console.log("Notarization: stapled and validated");
  } else if (signing.identity === "-") {
    console.log("Signing: ad-hoc (not notarized)");
  } else {
    console.log(`Signing: ${signing.identity} (not notarized; set CODEX_STATUS_BAR_NOTARIZE=1 to submit)`);
  }

  return { ...layout, checksum, size: zipInfo.size, signing };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  packageRelease().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
