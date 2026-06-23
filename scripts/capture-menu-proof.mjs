#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_OUTPUT = path.join(process.cwd(), "dist", "visual-proof", "codex-bar-menu-proof.png");
const DEFAULT_DELAY_SECONDS = 5;
const DEFAULT_PHASE_MS = 8_000;
const DEFAULT_SETTLE_MS = 1_200;
const DEFAULT_DEMO_READY_TIMEOUT_MS = 8_000;

export function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    output: DEFAULT_OUTPUT,
    delaySeconds: DEFAULT_DELAY_SECONDS,
    demo: true,
    phaseMs: DEFAULT_PHASE_MS,
    settleMs: DEFAULT_SETTLE_MS,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const [key, inlineValue] = arg.split("=", 2);
    const nextValue = () => {
      const value = inlineValue ?? argv[++index];
      if (!value || value.startsWith("--")) throw new Error(`${key} requires a value`);
      return value;
    };
    switch (key) {
      case "--output":
        options.output = path.resolve(nextValue());
        break;
      case "--delay-seconds":
        options.delaySeconds = positiveNumber(nextValue(), key);
        break;
      case "--phase-ms":
        options.phaseMs = positiveNumber(nextValue(), key);
        break;
      case "--settle-ms":
        options.settleMs = positiveNumber(nextValue(), key);
        break;
      case "--no-demo":
        options.demo = false;
        break;
      case "--help":
        options.help = true;
        break;
      default:
        throw new Error(`unknown option ${arg}`);
    }
  }

  return options;
}

function positiveNumber(value, label) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${label} must be a positive number`);
  return parsed;
}

export function screenshotArgs(options) {
  return ["-x", "-T", String(options.delaySeconds), options.output];
}

export function captureFailureMessage(result) {
  const combined = `${result.stderr || ""}\n${result.stdout || ""}`.trim();
  if (/could not create image from display|not authorized|screen recording|permission/i.test(combined)) {
    return [
      "macOS blocked screen capture.",
      "Grant Screen Recording permission to the terminal app running this command, then run it again.",
      "System Settings -> Privacy & Security -> Screen Recording.",
      combined,
    ].filter(Boolean).join("\n");
  }
  return combined || `screencapture exited ${result.code}`;
}

async function run(command, args, options = {}) {
  return await new Promise((resolve) => {
    const child = spawn(command, args, {
      ...options,
      stdio: options.stdio || ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      stdout += text;
      options.onStdout?.(text);
    });
    child.stderr?.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      stderr += text;
      options.onStderr?.(text);
    });
    child.on("error", (error) => resolve({ code: 127, stdout, stderr: error.message }));
    child.on("exit", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

async function spawnDemo(options) {
  const child = spawn(process.execPath, [
    path.join(process.cwd(), "scripts", "demo-live.mjs"),
    "--phase-ms",
    String(options.phaseMs),
    "--settle-ms",
    String(options.settleMs),
  ], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  let readyResolve;
  const ready = new Promise((resolve) => {
    readyResolve = resolve;
  });

  child.stdout.on("data", (chunk) => {
    const text = chunk.toString("utf8");
    stdout += text;
    process.stdout.write(text);
    if (text.includes("Showing approval:")) readyResolve(true);
  });
  child.stderr.on("data", (chunk) => {
    const text = chunk.toString("utf8");
    stderr += text;
    process.stderr.write(text);
  });

  const done = new Promise((resolve) => {
    child.on("error", (error) => resolve({ code: 127, stdout, stderr: error.message }));
    child.on("exit", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });

  const readyResult = await Promise.race([
    ready,
    sleep(DEFAULT_DEMO_READY_TIMEOUT_MS).then(() => false),
    done.then((result) => {
      throw new Error(`demo exited before approval phase: ${result.stderr.trim() || result.stdout.trim() || `exit ${result.code}`}`);
    }),
  ]);

  if (!readyResult) {
    throw new Error("demo did not reach the approval phase before the capture timeout");
  }

  return { child, done };
}

async function waitForDemo(demo) {
  if (!demo) return;
  const result = await demo.done;
  if (result.code !== 0) {
    throw new Error(`demo failed: ${result.stderr.trim() || result.stdout.trim() || `exit ${result.code}`}`);
  }
}

async function capture(options) {
  await mkdir(path.dirname(options.output), { recursive: true });
  console.log(`Capture output: ${options.output}`);
  console.log(`When the macOS countdown starts, click the Codex Bar menu item and leave the dropdown open.`);
  console.log(`Capturing in ${options.delaySeconds}s...`);
  const result = await run("/usr/sbin/screencapture", screenshotArgs(options));
  if (result.code !== 0) throw new Error(captureFailureMessage(result));

  const info = await stat(options.output);
  if (info.size < 8_000) {
    throw new Error(`screenshot at ${options.output} is too small to be useful (${info.size} bytes)`);
  }
  return { output: options.output, size: info.size };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function main(argv = process.argv.slice(2)) {
  if (process.platform !== "darwin") {
    throw new Error("Codex Bar menu capture currently supports macOS only");
  }

  const options = parseArgs(argv);
  if (options.help) {
    console.log([
      "Usage: npm run capture:menu -- [options]",
      "",
      "Options:",
      "  --output <path>          PNG output path",
      "  --delay-seconds <n>     macOS screencapture countdown before capture",
      "  --phase-ms <n>          demo phase duration when launching the live demo",
      "  --settle-ms <n>         app settle time passed to the live demo",
      "  --no-demo               capture the current screen without launching the demo",
    ].join("\n"));
    return;
  }

  const demo = options.demo ? await spawnDemo(options) : null;
  try {
    const result = await capture(options);
    console.log(`Codex Bar menu proof captured: ${result.output} (${result.size} bytes)`);
  } finally {
    await waitForDemo(demo);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
