#!/usr/bin/env node
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

const DEFAULT_LIVE_TIMEOUT_MS = 15_000;
const DEFAULT_INTERVAL_MS = 1_000;

export function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    install: true,
    liveRenderSmoke: true,
    perfSmoke: true,
    stateSmoke: true,
    renderSmoke: true,
    snapshotSmoke: true,
    privacyAudit: true,
    integrationBoundaryAudit: true,
    liveTimeoutMs: DEFAULT_LIVE_TIMEOUT_MS,
    intervalMs: DEFAULT_INTERVAL_MS,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const [key, inlineValue] = arg.split("=", 2);
    const nextValue = () => inlineValue ?? argv[++index];
    switch (key) {
      case "--skip-install":
        options.install = false;
        break;
      case "--skip-live-render-smoke":
        options.liveRenderSmoke = false;
        break;
      case "--skip-perf-smoke":
        options.perfSmoke = false;
        break;
      case "--skip-state-smoke":
        options.stateSmoke = false;
        break;
      case "--skip-render-smoke":
        options.renderSmoke = false;
        break;
      case "--skip-snapshot-smoke":
        options.snapshotSmoke = false;
        break;
      case "--skip-privacy-audit":
        options.privacyAudit = false;
        break;
      case "--skip-integration-boundary-audit":
        options.integrationBoundaryAudit = false;
        break;
      case "--live-timeout-ms":
        options.liveTimeoutMs = positiveNumber(nextValue(), key);
        break;
      case "--interval-ms":
        options.intervalMs = positiveNumber(nextValue(), key);
        break;
      default:
        throw new Error(`unknown option ${arg}`);
    }
  }

  if (options.intervalMs > options.liveTimeoutMs) {
    throw new Error("--interval-ms must be less than or equal to --live-timeout-ms");
  }
  return options;
}

function positiveNumber(value, label) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${label} must be a positive number`);
  return parsed;
}

export function setupSteps(options = parseArgs()) {
  const steps = [
    {
      label: "Validate plugin metadata and hooks",
      command: "npm",
      args: ["run", "validate:plugin"],
    },
  ];

  if (options.integrationBoundaryAudit) {
    steps.push({
      label: "Audit Codex app integration boundary",
      command: "npm",
      args: ["run", "audit:integration-boundary"],
    });
  }

  if (options.install) {
    steps.push({
      label: "Build, launch, and live-check Codex Bar",
      command: "npm",
      args: [
        "run",
        "install:local",
        "--",
        "--live-timeout-ms",
        String(options.liveTimeoutMs),
        "--interval-ms",
        String(options.intervalMs),
      ],
    });
  }

  if (options.liveRenderSmoke) {
    steps.push({
      label: "Render live installed state through native formatter",
      command: "npm",
      args: ["run", "smoke:live-render"],
    });
  }

  if (options.perfSmoke) {
    steps.push({
      label: "Sample live app and collector CPU/RSS",
      command: "npm",
      args: ["run", "smoke:perf"],
    });
  }

  if (options.stateSmoke) {
    steps.push({
      label: "Exercise approval, progress, and completed state reducer",
      command: "npm",
      args: ["run", "smoke:state"],
    });
  }

  if (options.renderSmoke) {
    steps.push({
      label: "Render approval, progress, and completed states through native formatter",
      command: "npm",
      args: ["run", "smoke:render"],
    });
    steps.push({
      label: "Render public hook approval and progress states through native formatter",
      command: "npm",
      args: ["run", "smoke:hook-render"],
    });
  }

  if (options.snapshotSmoke) {
    steps.push({
      label: "Render permission-free AppKit menu snapshots and visual proof",
      command: "npm",
      args: ["run", "smoke:visual-proof"],
    });
  }

  if (options.privacyAudit) {
    steps.push({
      label: "Audit live minimized state for privacy leaks",
      command: "npm",
      args: ["run", "audit:privacy"],
    });
  }

  return steps;
}

async function runStep(step) {
  console.log(`\n==> ${step.label}`);
  console.log(`$ ${[step.command, ...step.args].join(" ")}`);
  const code = await new Promise((resolve) => {
    const child = spawn(step.command, step.args, { stdio: "inherit" });
    child.on("error", (error) => {
      console.error(error.message);
      resolve(127);
    });
    child.on("exit", (exitCode) => resolve(exitCode ?? 1));
  });
  if (code !== 0) throw new Error(`${step.label} failed with exit code ${code}`);
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const steps = setupSteps(options);
  console.log("Codex Bar setup will run:");
  for (const [index, step] of steps.entries()) {
    console.log(`${index + 1}. ${step.label}`);
  }

  for (const step of steps) {
    await runStep(step);
  }

  console.log("\nCodex Bar setup passed.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
