#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_MAX_STRING_LENGTH = 500;
const FORBIDDEN_KEY_PATTERN = /(raw|transcript|payload|message|content|prompt|response|output|stdout|stderr|argument|cookie|password|secret|api[_-]?key|access[_-]?token|tool[_-]?result)/i;
const SECRET_VALUE_PATTERNS = [
  /sk-[A-Za-z0-9_-]{20,}/,
  /gh[pousr]_[A-Za-z0-9_]{20,}/,
  /AKIA[0-9A-Z]{16}/,
  /ft_[A-Za-z0-9_-]{20,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];

const ROOT_KEYS = new Set(["version", "installId", "updatedAt", "attention", "headline", "detail", "current", "progress", "aggregate", "sessions"]);
const CURRENT_KEYS = new Set(["status", "event", "toolName", "startedAt"]);
const AGGREGATE_KEYS = new Set(["runningSessions", "completedSessions", "approvalsRequired", "totalToolCalls", "activeSince"]);
const SESSION_KEYS = new Set([
  "id",
  "threadId",
  "shortId",
  "displayName",
  "label",
  "labelSource",
  "openURL",
  "cwd",
  "project",
  "model",
  "status",
  "startedAt",
  "updatedAt",
  "lastActivityAt",
  "completedAt",
  "currentTurnStartedAt",
  "currentTool",
  "lastEvent",
  "approvalRequired",
  "turnsStarted",
  "turnsCompleted",
  "toolCallsStarted",
  "toolCallsCompleted",
  "progress",
  "goal",
  "stale",
]);
const PROGRESS_KEYS = new Set(["label", "done", "total", "items", "source"]);
const PROGRESS_ITEM_KEYS = new Set(["step", "status"]);
const GOAL_KEYS = new Set(["status", "tokenBudget", "tokensUsed", "timeUsedSeconds", "createdAt", "updatedAt"]);

export function defaultStatePath(env = process.env) {
  if (env.CODEX_STATUS_BAR_STATE) return path.resolve(env.CODEX_STATUS_BAR_STATE);
  const codexHome = path.resolve(env.CODEX_HOME || path.join(os.homedir(), ".codex"));
  const statusRoot = env.CODEX_STATUS_BAR_HOME
    ? path.resolve(env.CODEX_STATUS_BAR_HOME)
    : path.join(codexHome, "statusbar");
  return path.join(statusRoot, "state.json");
}

export function parseArgs(argv = process.argv.slice(2), env = process.env) {
  const options = {
    statePath: defaultStatePath(env),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const [key, inlineValue] = arg.split("=", 2);
    const nextValue = () => inlineValue ?? argv[++index];
    switch (key) {
      case "--state":
        options.statePath = path.resolve(nextValue());
        break;
      default:
        throw new Error(`unknown option ${arg}`);
    }
  }

  return options;
}

export async function auditStateFile(statePath) {
  const parsed = JSON.parse(await readFile(statePath, "utf8"));
  return auditStateObject(parsed);
}

export function auditStateObject(state) {
  const findings = [];
  visitState(state, "state", ROOT_KEYS, findings);
  return findings;
}

function visitState(value, location, allowedKeys, findings) {
  if (!isPlainObject(value)) {
    findings.push(`${location} must be an object`);
    return;
  }
  auditObject(value, location, allowedKeys, findings);

  if ("current" in value) visitNullableObject(value.current, `${location}.current`, CURRENT_KEYS, findings);
  if ("aggregate" in value) visitNullableObject(value.aggregate, `${location}.aggregate`, AGGREGATE_KEYS, findings);
  if ("progress" in value) visitProgress(value.progress, `${location}.progress`, findings);
  if ("sessions" in value) visitSessions(value.sessions, `${location}.sessions`, findings);
}

function visitSessions(value, location, findings) {
  if (!isPlainObject(value)) {
    findings.push(`${location} must be an object`);
    return;
  }
  for (const [id, session] of Object.entries(value)) {
    auditString(id, `${location} key`, findings, 160);
    visitNullableObject(session, `${location}.${id}`, SESSION_KEYS, findings);
    if (isPlainObject(session)) {
      if ("progress" in session) visitProgress(session.progress, `${location}.${id}.progress`, findings);
      if ("goal" in session) visitNullableObject(session.goal, `${location}.${id}.goal`, GOAL_KEYS, findings);
    }
  }
}

function visitProgress(value, location, findings) {
  if (value === null || value === undefined) return;
  if (!isPlainObject(value)) {
    findings.push(`${location} must be an object or null`);
    return;
  }
  auditObject(value, location, PROGRESS_KEYS, findings);
  if (!Array.isArray(value.items)) {
    findings.push(`${location}.items must be an array`);
    return;
  }
  value.items.forEach((item, index) => {
    visitNullableObject(item, `${location}.items[${index}]`, PROGRESS_ITEM_KEYS, findings);
  });
}

function visitNullableObject(value, location, allowedKeys, findings) {
  if (value === null || value === undefined) return;
  if (!isPlainObject(value)) {
    findings.push(`${location} must be an object or null`);
    return;
  }
  auditObject(value, location, allowedKeys, findings);
}

function auditObject(value, location, allowedKeys, findings) {
  for (const [key, child] of Object.entries(value)) {
    const childLocation = `${location}.${key}`;
    if (!allowedKeys.has(key)) findings.push(`${childLocation} is not part of the minimized state schema`);
    if (FORBIDDEN_KEY_PATTERN.test(key)) findings.push(`${childLocation} uses a forbidden raw-data key`);
    auditValue(child, childLocation, findings);
  }
}

function auditValue(value, location, findings) {
  if (typeof value === "string") {
    auditString(value, location, findings);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => auditValue(item, `${location}[${index}]`, findings));
    return;
  }
  if (isPlainObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      const childLocation = `${location}.${key}`;
      if (FORBIDDEN_KEY_PATTERN.test(key)) findings.push(`${childLocation} uses a forbidden raw-data key`);
      auditValue(child, childLocation, findings);
    }
  }
}

function auditString(value, location, findings, maxLength = DEFAULT_MAX_STRING_LENGTH) {
  if (value.length > maxLength) findings.push(`${location} exceeds ${maxLength} characters`);
  if (/[\r\n]/.test(value)) findings.push(`${location} contains a newline`);
  if (/\bhttps?:\/\//i.test(value)) findings.push(`${location} contains an HTTP URL`);
  if (SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value))) {
    findings.push(`${location} looks like a secret value`);
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const options = parseArgs(argv, env);
  const findings = await auditStateFile(options.statePath);
  if (findings.length > 0) {
    console.error("Codex Bar privacy audit failed:");
    for (const finding of findings) console.error(`- ${finding}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Codex Bar privacy audit passed for ${options.statePath}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
