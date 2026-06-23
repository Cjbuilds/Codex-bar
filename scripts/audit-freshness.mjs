#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { defaultStatePath } from "./audit-privacy.mjs";

const ALWAYS_VISIBLE_STATUSES = new Set([
  "approval",
  "running",
  "thinking",
  "active",
  "goal",
  "compacting",
]);

export function parseArgs(argv = process.argv.slice(2), env = process.env) {
  const options = {
    statePath: defaultStatePath(env),
    now: new Date(),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const [key, inlineValue] = arg.split("=", 2);
    const nextValue = () => inlineValue ?? argv[++index];
    switch (key) {
      case "--state":
        options.statePath = nextValue();
        break;
      case "--now":
        options.now = parseDate(nextValue(), key);
        break;
      default:
        throw new Error(`unknown option ${arg}`);
    }
  }

  return options;
}

export async function auditFreshnessFile(statePath, options = {}) {
  const parsed = JSON.parse(await readFile(statePath, "utf8"));
  return auditFreshnessObject(parsed, options);
}

export function auditFreshnessObject(state, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  if (!Number.isFinite(now.getTime())) throw new Error("now must be a valid date");

  const todayStartMs = startOfLocalDayMs(now);
  const findings = [];
  const sessions = state?.sessions;
  if (!sessions || typeof sessions !== "object" || Array.isArray(sessions)) {
    return ["state.sessions must be an object"];
  }

  for (const [id, session] of Object.entries(sessions)) {
    const status = String(session?.status || "idle");
    const approvalRequired = Boolean(session?.approvalRequired);
    if (approvalRequired || ALWAYS_VISIBLE_STATUSES.has(status)) continue;

    const lastActivityMs = Date.parse(session?.lastActivityAt || session?.updatedAt || "");
    if (!Number.isFinite(lastActivityMs)) {
      findings.push(`${id} is visible without a valid lastActivityAt`);
      continue;
    }
    if (lastActivityMs < todayStartMs) {
      findings.push(`${id} is a stale ${status} session from before the current local day`);
    }
  }

  return findings;
}

export function startOfLocalDayMs(date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy.getTime();
}

function parseDate(value, label) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error(`${label} must be a valid date`);
  return parsed;
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const options = parseArgs(argv, env);
  const findings = await auditFreshnessFile(options.statePath, { now: options.now });
  if (findings.length > 0) {
    console.error("Codex Bar freshness audit failed:");
    for (const finding of findings) console.error(`- ${finding}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Codex Bar freshness audit passed for ${options.statePath}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
