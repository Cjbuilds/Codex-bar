#!/usr/bin/env node
import { spawn } from "node:child_process";
import { chmod, copyFile, mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_COMMANDS = [
  { label: "Check generated assets", command: "npm", args: ["run", "check:assets"] },
  { label: "Validate plugin metadata", command: "npm", args: ["run", "validate:plugin"] },
  { label: "Audit release readiness", command: "npm", args: ["run", "audit:readiness"] },
  { label: "Run Node tests", command: "npm", args: ["run", "test"] },
  { label: "Package release artifact", command: "npm", args: ["run", "package:release"] },
];

export function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    root: process.cwd(),
    keep: false,
    includeUntracked: true,
    tempRoot: null,
    commands: DEFAULT_COMMANDS,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const [key, inlineValue] = arg.split("=", 2);
    const nextValue = () => inlineValue ?? argv[++index];
    switch (key) {
      case "--root":
        options.root = path.resolve(nextValue());
        break;
      case "--tmp-dir":
        options.tempRoot = path.resolve(nextValue());
        break;
      case "--keep":
        options.keep = true;
        break;
      case "--tracked-only":
        options.includeUntracked = false;
        break;
      case "--skip-package":
        options.commands = options.commands.filter((step) => step.args.join(" ") !== "run package:release");
        break;
      default:
        throw new Error(`unknown option ${arg}`);
    }
  }

  return options;
}

export function cleanCheckoutCommands(options = {}) {
  const commands = options.commands || DEFAULT_COMMANDS;
  return commands.map((step) => ({
    label: step.label,
    command: step.command,
    args: [...step.args],
  }));
}

export function assertCleanCheckoutFiles(files) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error("clean checkout did not find any Git-visible files");
  }

  const required = [
    "AGENTS.md",
    "package.json",
    "README.md",
    "SECURITY.md",
    "scripts/audit-freshness.mjs",
    "scripts/audit-integration-boundary.mjs",
    "plugins/codex-status-bar/.codex-plugin/plugin.json",
    "plugins/codex-status-bar/app/Package.swift",
    "plugins/codex-status-bar/scripts/collector.mjs",
  ];

  for (const file of required) {
    if (!files.includes(file)) throw new Error(`clean checkout is missing ${file}`);
  }

  for (const file of files) {
    if (path.isAbsolute(file) || file.split(/[\\/]/).includes("..")) {
      throw new Error(`clean checkout file path is unsafe: ${file}`);
    }
    if (file === ".git" || file.startsWith(".git/")) {
      throw new Error("clean checkout must not include .git metadata");
    }
    if (file === "dist" || file.startsWith("dist/")) {
      throw new Error("clean checkout must not include dist artifacts");
    }
    if (file === "node_modules" || file.startsWith("node_modules/")) {
      throw new Error("clean checkout must not include node_modules");
    }
  }
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

async function gitVisibleFiles(root, includeUntracked) {
  const args = ["ls-files", "-z", "--cached"];
  if (includeUntracked) args.push("--others", "--exclude-standard");
  const result = await runChecked("git", args, { cwd: root });
  return result.stdout.split("\0").filter(Boolean).sort();
}

async function copyGitVisibleFiles({ root, checkoutDir, files }) {
  for (const file of files) {
    const source = path.join(root, file);
    const destination = path.join(checkoutDir, file);
    const sourceStat = await stat(source);
    if (!sourceStat.isFile()) continue;
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(source, destination);
    await chmod(destination, sourceStat.mode & 0o777);
  }
}

async function runCheckoutCommands({ checkoutDir, commands }) {
  for (const step of commands) {
    console.log(`\n==> ${step.label}`);
    console.log(`$ ${[step.command, ...step.args].join(" ")}`);
    await runChecked(step.command, step.args, {
      cwd: checkoutDir,
      env: {
        ...process.env,
        CODEX_BAR_CLEAN_CHECKOUT: "1",
      },
      stdio: "inherit",
    });
  }
}

export async function runCleanCheckoutSmoke(options = parseArgs()) {
  const tempRoot = options.tempRoot
    ? path.resolve(options.tempRoot)
    : await mkdtemp(path.join(os.tmpdir(), "codex-bar-clean-checkout-"));
  const checkoutDir = path.join(tempRoot, "repo");
  const commands = cleanCheckoutCommands(options);
  const files = await gitVisibleFiles(options.root, options.includeUntracked);
  assertCleanCheckoutFiles(files);

  await rm(checkoutDir, { recursive: true, force: true });
  await mkdir(checkoutDir, { recursive: true });
  await copyGitVisibleFiles({ root: options.root, checkoutDir, files });

  try {
    await runCheckoutCommands({ checkoutDir, commands });
    return { checkoutDir, files, commands };
  } finally {
    if (!options.keep) await rm(tempRoot, { recursive: true, force: true });
  }
}

export async function main(argv = process.argv.slice(2)) {
  const result = await runCleanCheckoutSmoke(parseArgs(argv));
  console.log("\nCodex Bar clean checkout smoke passed");
  console.log(`checkout: ${result.checkoutDir}`);
  console.log(`files: ${result.files.length}`);
  for (const step of result.commands) {
    console.log(`checked: ${step.args.join(" ")}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
