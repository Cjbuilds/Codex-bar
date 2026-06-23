#!/usr/bin/env node
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_DURATION_MS = 30_000;
const DEFAULT_INTERVAL_MS = 2_000;
const DEFAULT_MAX_APP_AVG_CPU = 5;
const DEFAULT_MAX_COLLECTOR_AVG_CPU = 10;
const DEFAULT_MAX_RSS_MB = 512;

function codexHome(env = process.env) {
  return path.resolve(env.CODEX_HOME || path.join(os.homedir(), ".codex"));
}

function statusRoot(env = process.env) {
  if (env.CODEX_STATUS_BAR_HOME) return path.resolve(env.CODEX_STATUS_BAR_HOME);
  return path.join(codexHome(env), "statusbar");
}

function appPath(env = process.env) {
  return env.CODEX_STATUS_BAR_APP || path.join(statusRoot(env), "Codex Bar.app");
}

export function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    durationMs: DEFAULT_DURATION_MS,
    intervalMs: DEFAULT_INTERVAL_MS,
    maxAppAverageCpu: DEFAULT_MAX_APP_AVG_CPU,
    maxCollectorAverageCpu: DEFAULT_MAX_COLLECTOR_AVG_CPU,
    maxRssMb: DEFAULT_MAX_RSS_MB,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const [key, inlineValue] = arg.split("=", 2);
    const nextValue = () => inlineValue ?? argv[++index];
    switch (key) {
      case "--duration-ms":
        options.durationMs = positiveNumber(nextValue(), key);
        break;
      case "--interval-ms":
        options.intervalMs = positiveNumber(nextValue(), key);
        break;
      case "--max-app-average-cpu":
        options.maxAppAverageCpu = positiveNumber(nextValue(), key);
        break;
      case "--max-collector-average-cpu":
        options.maxCollectorAverageCpu = positiveNumber(nextValue(), key);
        break;
      case "--max-rss-mb":
        options.maxRssMb = positiveNumber(nextValue(), key);
        break;
      case "--json":
        options.json = true;
        break;
      default:
        throw new Error(`unknown option ${arg}`);
    }
  }

  if (options.intervalMs > options.durationMs) {
    throw new Error("--interval-ms must be less than or equal to --duration-ms");
  }
  return options;
}

function positiveNumber(value, label) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${label} must be a positive number`);
  return parsed;
}

export function parsePsLine(line, label) {
  const parts = line.trim().split(/\s+/);
  if (parts.length < 7) throw new Error(`unexpected ps output for ${label}: ${line}`);
  const [pid, ppid, cpu, memory, rssKb, elapsed, ...commandParts] = parts;
  return {
    label,
    pid: Number(pid),
    ppid: Number(ppid),
    cpu: Number(cpu),
    memory: Number(memory),
    rssKb: Number(rssKb),
    elapsed,
    command: commandParts.join(" "),
  };
}

export function summarizeSamples(samples) {
  const byLabel = new Map();
  for (const sample of samples) {
    if (!byLabel.has(sample.label)) byLabel.set(sample.label, []);
    byLabel.get(sample.label).push(sample);
  }

  const summaries = {};
  for (const [label, values] of byLabel.entries()) {
    const cpuValues = values.map((value) => value.cpu);
    const rssValues = values.map((value) => value.rssKb);
    summaries[label] = {
      pid: values.at(-1).pid,
      samples: values.length,
      averageCpu: round(average(cpuValues), 2),
      maxCpu: round(Math.max(...cpuValues), 2),
      averageRssMb: round(average(rssValues) / 1024, 1),
      maxRssMb: round(Math.max(...rssValues) / 1024, 1),
      command: values.at(-1).command,
    };
  }
  return summaries;
}

export function evaluateSummary(summary, options) {
  const failures = [];
  if (summary.app?.averageCpu > options.maxAppAverageCpu) {
    failures.push(`app average CPU ${summary.app.averageCpu}% exceeded ${options.maxAppAverageCpu}%`);
  }
  if (summary.collector?.averageCpu > options.maxCollectorAverageCpu) {
    failures.push(`collector average CPU ${summary.collector.averageCpu}% exceeded ${options.maxCollectorAverageCpu}%`);
  }
  for (const [label, processSummary] of Object.entries(summary)) {
    if (processSummary.maxRssMb > options.maxRssMb) {
      failures.push(`${label} max RSS ${processSummary.maxRssMb} MiB exceeded ${options.maxRssMb} MiB`);
    }
  }
  return failures;
}

async function pgrep(pattern) {
  const result = await run("/usr/bin/pgrep", ["-f", pattern]);
  if (result.code !== 0) return null;
  return result.stdout.trim().split(/\s+/).filter(Boolean)[0] || null;
}

async function sampleProcess(pid, label) {
  const result = await run("/bin/ps", [
    "-p", String(pid),
    "-o", "pid=",
    "-o", "ppid=",
    "-o", "pcpu=",
    "-o", "pmem=",
    "-o", "rss=",
    "-o", "etime=",
    "-o", "command=",
  ]);
  if (result.code !== 0 || !result.stdout.trim()) throw new Error(`${label} process ${pid} disappeared`);
  return parsePsLine(result.stdout, label);
}

async function findProcesses(env = process.env) {
  const installedApp = appPath(env);
  const appExecutable = path.join(installedApp, "Contents", "MacOS", "CodexStatusBar");
  const collector = path.join(installedApp, "Contents", "Resources", "collector.mjs");
  const appPid = await pgrep(appExecutable);
  const collectorPid = await pgrep(`${collector} --watch`);
  if (!appPid) throw new Error(`Codex Bar app process is not running at ${appExecutable}`);
  if (!collectorPid) throw new Error(`Codex Bar collector process is not running at ${collector}`);
  return { app: appPid, collector: collectorPid };
}

async function sampleLive(options, env = process.env) {
  const pids = await findProcesses(env);
  const samples = [];
  const started = Date.now();

  while (Date.now() - started <= options.durationMs || samples.length === 0) {
    samples.push(await sampleProcess(pids.app, "app"));
    samples.push(await sampleProcess(pids.collector, "collector"));
    if (Date.now() - started >= options.durationMs) break;
    await sleep(options.intervalMs);
  }

  return summarizeSamples(samples);
}

async function run(command, args) {
  return await new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("error", (error) => resolve({ code: 127, stdout, stderr: error.message }));
    child.on("exit", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

function average(values) {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function round(value, places) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function printHuman(summary, options, failures) {
  console.log(`Sampled Codex Bar for ${Math.round(options.durationMs / 1000)}s at ${Math.round(options.intervalMs / 1000)}s intervals`);
  for (const [label, processSummary] of Object.entries(summary)) {
    console.log(`${label}: avg CPU ${processSummary.averageCpu}%, max CPU ${processSummary.maxCpu}%, avg RSS ${processSummary.averageRssMb} MiB, max RSS ${processSummary.maxRssMb} MiB, pid ${processSummary.pid}`);
  }
  if (failures.length) {
    console.error("Performance sample failed:");
    for (const failure of failures) console.error(`- ${failure}`);
  } else {
    console.log("Codex Bar performance sample passed");
  }
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const options = parseArgs(argv);
  const summary = await sampleLive(options, env);
  const failures = evaluateSummary(summary, options);
  if (options.json) {
    console.log(JSON.stringify({ options, summary, failures }, null, 2));
  } else {
    printHuman(summary, options, failures);
  }
  if (failures.length) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
