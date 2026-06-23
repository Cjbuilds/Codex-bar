#!/usr/bin/env node
import { constants as fsConstants } from "node:fs";
import { access, mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

const DEFAULT_INTERVAL_MS = 1500;
const MAX_ROLLOUT_TAIL_BYTES = 1024 * 1024;
const MAX_PLAN_ITEMS = 20;
const DEFAULT_THREAD_LIMIT = 8;
const ACTIVE_WINDOW_MS = 10 * 60 * 1000;
const RUNNING_WINDOW_MS = 2 * 60 * 1000;
const PREVIOUS_SESSION_WINDOW_MS = 30 * 60 * 1000;

export function codexHome(env = process.env) {
  return path.resolve(env.CODEX_HOME || path.join(os.homedir(), ".codex"));
}

export function statusRoot(env = process.env) {
  if (env.CODEX_STATUS_BAR_HOME) return path.resolve(env.CODEX_STATUS_BAR_HOME);
  return path.join(codexHome(env), "statusbar");
}

export function defaultStatePath(env = process.env) {
  if (env.CODEX_STATUS_BAR_STATE) return path.resolve(env.CODEX_STATUS_BAR_STATE);
  return path.join(statusRoot(env), "state.json");
}

function dbPath(name, env = process.env) {
  if (name === "state" && env.CODEX_STATUS_BAR_STATE_DB) return path.resolve(env.CODEX_STATUS_BAR_STATE_DB);
  if (name === "goals" && env.CODEX_STATUS_BAR_GOALS_DB) return path.resolve(env.CODEX_STATUS_BAR_GOALS_DB);

  const home = codexHome(env);
  const candidates = [
    path.join(home, `${name === "state" ? "state_5" : "goals_1"}.sqlite`),
    path.join(home, "sqlite", `${name === "state" ? "state_5" : "goals_1"}.sqlite`),
  ];
  return candidates[0];
}

async function existingPath(candidates) {
  for (const candidate of candidates) {
    try {
      await access(candidate, fsConstants.R_OK);
      return candidate;
    } catch {
      // Try the next known Codex DB location.
    }
  }
  return null;
}

export async function collectOnce(options = {}) {
  const env = options.env || process.env;
  const statePath = options.statePath || defaultStatePath(env);
  const now = options.now || new Date();
  const previousState = options.previousState || await readJson(statePath);
  const stateDb = await existingPath([
    dbPath("state", env),
    path.join(codexHome(env), "sqlite", "state_5.sqlite"),
  ]);
  const goalsDb = await existingPath([
    dbPath("goals", env),
    path.join(codexHome(env), "sqlite", "goals_1.sqlite"),
  ]);

  if (!stateDb) {
    return previousState || emptyState(now.toISOString());
  }

  const threadLimit = Number(env.CODEX_STATUS_BAR_THREAD_LIMIT || DEFAULT_THREAD_LIMIT);
  const threads = await queryThreads(stateDb, Number.isFinite(threadLimit) ? threadLimit : DEFAULT_THREAD_LIMIT);
  const goals = goalsDb ? await queryGoals(goalsDb) : [];
  const rolloutSummaries = {};
  await Promise.all(threads.map(async (thread) => {
    if (!thread.rollout_path) return;
    rolloutSummaries[thread.id] = await summarizeRolloutFile(thread.rollout_path);
  }));

  const next = buildStateFromSources({
    threads,
    goals,
    rolloutSummaries,
    previousState,
    now,
    hideTitles: truthy(env.CODEX_STATUS_BAR_HIDE_TITLES),
  });
  await writeIfChanged(statePath, next);
  return next;
}

async function queryThreads(stateDb, limit) {
  const sql = `
    select id, cwd, title, preview, rollout_path, created_at_ms, updated_at_ms, recency_at_ms, source
    from threads
    where archived = 0 and preview <> ''
    order by recency_at_ms desc
    limit ${Math.max(1, Math.min(20, limit))}
  `;
  return await sqliteJson(stateDb, sql);
}

async function queryGoals(goalsDb) {
  const sql = `
    select thread_id, status, token_budget, tokens_used, time_used_seconds,
           created_at_ms, updated_at_ms
    from thread_goals
    order by updated_at_ms desc
    limit 50
  `;
  return await sqliteJson(goalsDb, sql);
}

async function sqliteJson(db, sql) {
  return await new Promise((resolve) => {
    const child = spawn("sqlite3", ["-readonly", "-json", db, sql], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.on("error", () => resolve([]));
    child.on("exit", (code) => {
      if (code !== 0 || !stdout.trim()) {
        resolve([]);
        return;
      }
      try {
        const parsed = JSON.parse(stdout);
        resolve(Array.isArray(parsed) ? parsed : []);
      } catch {
        resolve([]);
      }
    });
  });
}

export async function summarizeRolloutFile(filePath) {
  try {
    const text = await readTail(filePath, MAX_ROLLOUT_TAIL_BYTES);
    return summarizeRolloutText(text);
  } catch {
    return {};
  }
}

async function readTail(filePath, maxBytes) {
  const info = await stat(filePath);
  const length = Math.min(info.size, maxBytes);
  const offset = Math.max(0, info.size - length);
  const handle = await open(filePath, "r");
  try {
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, offset);
    let text = buffer.toString("utf8");
    if (offset > 0) {
      const firstNewline = text.indexOf("\n");
      text = firstNewline >= 0 ? text.slice(firstNewline + 1) : "";
    }
    return text;
  } finally {
    await handle.close();
  }
}

export function summarizeRolloutText(text) {
  const summary = {
    progress: null,
    currentTool: null,
    lastEvent: null,
    lastActivityAtMs: null,
    currentTurnStartedAtMs: null,
    completedAtMs: null,
    turnsStarted: 0,
    turnsCompleted: 0,
    toolCallsStarted: 0,
    toolCallsCompleted: 0,
    openToolCall: false,
  };

  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const payload = entry && entry.payload;
    if (!payload || typeof payload !== "object") continue;

    const timestampMs = Date.parse(entry.timestamp || "");
    if (Number.isFinite(timestampMs)) {
      summary.lastActivityAtMs = Math.max(summary.lastActivityAtMs || 0, timestampMs);
    }
    summary.lastEvent = safeString(payload.type, 80) || summary.lastEvent;

    switch (payload.type) {
      case "task_started":
        summary.turnsStarted += 1;
        if (Number.isFinite(timestampMs)) summary.currentTurnStartedAtMs = timestampMs;
        break;
      case "task_complete":
        summary.turnsCompleted += 1;
        if (Number.isFinite(timestampMs)) summary.completedAtMs = timestampMs;
        summary.openToolCall = false;
        break;
      case "function_call":
      case "custom_tool_call":
        summary.toolCallsStarted += 1;
        summary.openToolCall = true;
        if (payload.name === "update_plan") {
          summary.progress = extractProgressFromArguments(payload.arguments) || summary.progress;
        } else {
          summary.currentTool = friendlyToolName(payload.name || payload.call_id || payload.type);
        }
        break;
      case "function_call_output":
      case "custom_tool_call_output":
      case "patch_apply_end":
      case "web_search_end":
        summary.toolCallsCompleted += 1;
        summary.openToolCall = false;
        break;
      default:
        break;
    }
  }

  return summary;
}

export function extractProgressFromArguments(rawArguments) {
  const parsed = parseJsonObject(rawArguments);
  const plan = Array.isArray(parsed?.plan) ? parsed.plan : Array.isArray(parsed?.todos) ? parsed.todos : null;
  if (!plan || plan.length === 0) return null;

  const items = plan.slice(0, MAX_PLAN_ITEMS).map((item) => ({
    step: safeString(item?.step || item?.title || item?.text || item?.name, 120) || "Task",
    status: safeString(item?.status || item?.state || "pending", 40) || "pending",
  }));
  const done = items.filter((item) => ["completed", "complete", "done"].includes(item.status)).length;
  return {
    label: "tasks",
    done,
    total: items.length,
    items,
    source: "rollout-update-plan",
  };
}

export function buildStateFromSources({ threads, goals, rolloutSummaries, previousState, now, hideTitles = false }) {
  const nowMs = now.getTime();
  const todayStartMs = startOfLocalDayMs(now);
  const installId = previousState?.installId || cryptoRandomId();
  const goalsByThread = new Map(goals.map((goal) => [goal.thread_id, goal]));
  const sessions = {};
  let visibleIndex = 0;

  threads.forEach((thread) => {
    const goal = goalsByThread.get(thread.id) || null;
    const rollout = rolloutSummaries[thread.id] || {};
    const previousSession = previousState?.sessions?.[thread.id] || null;
    const lastActivityMs = maxNumber([
      thread.updated_at_ms,
      thread.recency_at_ms,
      goal?.updated_at_ms,
      rollout.lastActivityAtMs,
    ]) || nowMs;
    const startedAtMs = maxNumber([thread.created_at_ms]) || lastActivityMs;
    const currentTurnStartedAtMs = rollout.currentTurnStartedAtMs || previousSessionMs(previousSession?.currentTurnStartedAt);
    const progress = rollout.progress || previousSession?.progress || null;
    const approvalRequired = Boolean(previousSession?.approvalRequired && nowMs - previousSessionMs(previousSession.lastActivityAt) < PREVIOUS_SESSION_WINDOW_MS);
    const status = deriveSessionStatus({ goal, rollout, progress, approvalRequired, lastActivityMs, nowMs });
    const project = safeBasename(thread.cwd);
    const label = sessionLabel(thread, project, { hideTitles }) || previousSession?.label || project;

    if (!shouldShowSession({ status, lastActivityMs, todayStartMs, approvalRequired })) {
      return;
    }

    visibleIndex += 1;

    sessions[thread.id] = {
      id: thread.id,
      threadId: thread.id,
      shortId: thread.id.slice(0, 8),
      displayName: `Codex ${visibleIndex}`,
      label,
      openURL: `codex://threads/${thread.id}`,
      cwd: thread.cwd,
      project,
      model: null,
      status,
      startedAt: iso(startedAtMs),
      updatedAt: iso(lastActivityMs),
      lastActivityAt: iso(lastActivityMs),
      completedAt: status === "completed" ? iso(rollout.completedAtMs || goal?.updated_at_ms || lastActivityMs) : null,
      currentTurnStartedAt: currentTurnStartedAtMs ? iso(currentTurnStartedAtMs) : null,
      currentTool: status === "running" ? rollout.currentTool || null : null,
      lastEvent: rollout.lastEvent || null,
      approvalRequired,
      turnsStarted: rollout.turnsStarted || previousSession?.turnsStarted || 0,
      turnsCompleted: rollout.turnsCompleted || previousSession?.turnsCompleted || 0,
      toolCallsStarted: rollout.toolCallsStarted || previousSession?.toolCallsStarted || 0,
      toolCallsCompleted: rollout.toolCallsCompleted || previousSession?.toolCallsCompleted || 0,
      progress,
      goal: goal ? {
        status: normalizeGoalStatus(goal.status),
        tokenBudget: goal.token_budget ?? null,
        tokensUsed: Number(goal.tokens_used || 0),
        timeUsedSeconds: Number(goal.time_used_seconds || 0),
        createdAt: iso(goal.created_at_ms || startedAtMs),
        updatedAt: iso(goal.updated_at_ms || lastActivityMs),
      } : null,
      stale: nowMs - lastActivityMs > ACTIVE_WINDOW_MS && normalizeGoalStatus(goal?.status) !== "active",
    };
  });

  mergeRecentHookSessions(sessions, previousState, nowMs);

  const sessionValues = Object.values(sessions)
    .sort((a, b) => Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt));
  const runningSessions = sessionValues.filter((session) =>
    ["approval", "running", "thinking", "active", "goal", "compacting"].includes(session.status)
  );
  const completedSessions = sessionValues.filter((session) => session.status === "completed");
  const approvalsRequired = sessionValues.filter((session) => session.approvalRequired).length;
  const sourceUpdatedAtMs = maxNumber(sessionValues.map((session) => Date.parse(session.lastActivityAt))) || nowMs;
  const activeProgress = sessionValues.find((session) =>
    session.progress?.total > 0 && ["approval", "running", "thinking", "active", "goal"].includes(session.status)
  )?.progress || null;
  const activeSince = runningSessions
    .map((session) => session.currentTurnStartedAt || session.goal?.createdAt || session.startedAt)
    .filter(Boolean)
    .sort()[0] || null;
  const headline = headlineFrom({ approvalsRequired, activeProgress, runningSessions, completedSessions });
  const firstSession = runningSessions[0] || sessionValues[0] || null;
  const detail = firstSession ? detailForSession(firstSession) : "Waiting for Codex activity";

  return {
    version: 1,
    installId,
    updatedAt: iso(sourceUpdatedAtMs),
    attention: approvalsRequired > 0 ? "approval" : null,
    headline,
    detail,
    current: {
      status: firstSession?.status || "idle",
      event: firstSession?.lastEvent || null,
      toolName: firstSession?.currentTool || null,
      startedAt: firstSession?.currentTurnStartedAt || firstSession?.startedAt || null,
    },
    progress: activeProgress,
    aggregate: {
      runningSessions: runningSessions.length,
      completedSessions: completedSessions.length,
      approvalsRequired,
      totalToolCalls: sessionValues.reduce((total, session) => total + Number(session.toolCallsCompleted || 0), 0),
      activeSince,
    },
    sessions,
  };
}

function deriveSessionStatus({ goal, rollout, progress, approvalRequired, lastActivityMs, nowMs }) {
  if (approvalRequired) return "approval";
  const goalStatus = normalizeGoalStatus(goal?.status);
  if (goalStatus === "complete") return "completed";
  if (rollout.openToolCall && nowMs - lastActivityMs <= RUNNING_WINDOW_MS) return "running";
  if (goalStatus === "active") {
    if (progress?.total > 0 && progress.done < progress.total) return "running";
    return nowMs - lastActivityMs <= ACTIVE_WINDOW_MS ? "thinking" : "goal";
  }
  if (nowMs - lastActivityMs <= RUNNING_WINDOW_MS) return "running";
  if (nowMs - lastActivityMs <= ACTIVE_WINDOW_MS) return "active";
  return "idle";
}

function headlineFrom({ approvalsRequired, activeProgress, runningSessions, completedSessions }) {
  if (approvalsRequired > 0) return `${approvalsRequired} waiting`;
  if (activeProgress?.total > 0) return `${activeProgress.done}/${activeProgress.total} ${activeProgress.label}`;
  if (runningSessions.length > 0) return `${runningSessions.length} active`;
  if (completedSessions.length > 0) return `${completedSessions.length} completed`;
  return "Codex idle";
}

function detailForSession(session) {
  if (session.approvalRequired) return `${session.displayName || "Codex"} waiting for approval`;
  if (session.progress?.total > 0) {
    return `${session.displayName || "Codex"} ${session.progress.done}/${session.progress.total} ${session.progress.label}`;
  }
  if (session.goal?.status) return `${session.displayName || "Codex"} goal ${session.goal.status}`;
  return `${session.displayName || "Codex"} ${session.status}`;
}

function mergeRecentHookSessions(sessions, previousState, nowMs) {
  if (!previousState?.sessions) return;
  for (const [id, session] of Object.entries(previousState.sessions)) {
    if (sessions[id]) continue;
    const lastActivity = previousSessionMs(session.lastActivityAt);
    if (!lastActivity || nowMs - lastActivity > PREVIOUS_SESSION_WINDOW_MS) continue;
    if (!["approval", "running", "thinking", "active", "compacting"].includes(session.status)) continue;
    sessions[id] = {
      ...session,
      displayName: session.displayName || `Codex ${Object.keys(sessions).length + 1}`,
      label: session.label || session.project || safeBasename(session.cwd),
      shortId: session.shortId || id.slice(0, 8),
      openURL: session.openURL || (looksLikeThreadId(id) ? `codex://threads/${id}` : null),
    };
  }
}

function shouldShowSession({ status, lastActivityMs, todayStartMs, approvalRequired }) {
  if (approvalRequired) return true;
  if (["approval", "running", "thinking", "active", "goal", "compacting"].includes(status)) return true;
  return lastActivityMs >= todayStartMs;
}

export function sessionLabel(thread, project, { hideTitles = false } = {}) {
  if (hideTitles) return project;
  return bestSessionLabel(thread.title) || bestSessionLabel(thread.preview) || project;
}

function bestSessionLabel(value) {
  if (typeof value !== "string") return null;
  const lines = value
    .split(/\r?\n/)
    .map(cleanSessionLabel)
    .filter(Boolean);
  if (!lines.length) return null;

  const nonRepoLines = lines.filter((line) => !/^[\w.-]+\/[\w.-]+$/.test(line));
  return safeString(nonRepoLines[0] || lines[0], 60);
}

function cleanSessionLabel(value) {
  return safeString(
    value
      .replace(/\[([^\]]+)\]\((?:https?|codex):\/\/[^)]*\)/g, "$1")
      .replace(/\bhttps?:\/\/\S+/g, "")
      .replace(/\bcodex:\/\/\S+/g, "")
      .replace(/^[#>\s-]+/g, ""),
    120
  );
}

async function writeIfChanged(statePath, state) {
  const next = `${JSON.stringify(state, null, 2)}\n`;
  const current = await readFile(statePath, "utf8").catch(() => null);
  if (current === next) return;
  await mkdir(path.dirname(statePath), { recursive: true, mode: 0o700 });
  const tempPath = `${statePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, next, { mode: 0o600 });
  await rename(tempPath, statePath);
}

async function readJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

function emptyState(nowIso) {
  return {
    version: 1,
    installId: cryptoRandomId(),
    updatedAt: nowIso,
    attention: null,
    headline: "Codex idle",
    detail: "Waiting for Codex activity",
    current: { status: "idle", event: null, toolName: null, startedAt: null },
    progress: null,
    aggregate: {
      runningSessions: 0,
      completedSessions: 0,
      approvalsRequired: 0,
      totalToolCalls: 0,
      activeSince: null,
    },
    sessions: {},
  };
}

function parseJsonObject(value) {
  if (!value) return null;
  if (typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function safeString(value, maxLength) {
  if (typeof value !== "string") return null;
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) return null;
  return compact.length > maxLength ? `${compact.slice(0, maxLength - 1)}...` : compact;
}

function safeBasename(cwd) {
  const value = safeString(cwd, 500) || "Workspace";
  return path.basename(value) || value;
}

function friendlyToolName(name) {
  const value = safeString(name, 80) || "tool";
  const labels = {
    exec_command: "terminal",
    write_stdin: "terminal",
    apply_patch: "editing files",
    update_plan: "planning",
    web_search: "web search",
  };
  return labels[value] || value;
}

function normalizeGoalStatus(status) {
  if (!status) return null;
  const value = String(status).replace(/_/g, "-");
  if (value === "budget-limited") return "budgetLimited";
  if (value === "usage-limited") return "usageLimited";
  return value;
}

function maxNumber(values) {
  const finite = values.map(Number).filter(Number.isFinite);
  return finite.length ? Math.max(...finite) : null;
}

function iso(ms) {
  return new Date(Number(ms)).toISOString();
}

function startOfLocalDayMs(date) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  return start.getTime();
}

function previousSessionMs(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : null;
}

function looksLikeThreadId(value) {
  return /^[0-9a-f-]{36}$/i.test(value);
}

function cryptoRandomId() {
  return randomUUID();
}

function truthy(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").toLowerCase());
}

async function acquireCollectorLock(root) {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const lockPath = path.join(root, "collector.lock");
  const previousPid = Number((await readFile(lockPath, "utf8").catch(() => "")).trim());
  if (previousPid && processAlive(previousPid)) return null;

  const handle = await open(lockPath, fsConstants.O_CREAT | fsConstants.O_TRUNC | fsConstants.O_WRONLY, 0o600);
  await handle.writeFile(String(process.pid));
  await handle.close();
  return async () => {
    await rm(lockPath, { force: true });
  };
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function parentAlive(env = process.env) {
  const parentPid = Number(env.CODEX_STATUS_BAR_PARENT_PID || 0);
  return !parentPid || processAlive(parentPid);
}

async function watch(env = process.env) {
  const root = statusRoot(env);
  const release = await acquireCollectorLock(root);
  if (!release) return;
  const intervalMs = Math.max(500, Number(env.CODEX_STATUS_BAR_INTERVAL_MS || DEFAULT_INTERVAL_MS));
  try {
    while (parentAlive(env)) {
      await collectOnce({ env }).catch(() => {});
      await sleep(intervalMs);
    }
  } finally {
    await release();
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function main(argv = process.argv, env = process.env) {
  if (argv.includes("--watch")) {
    await watch(env);
    return;
  }
  await collectOnce({ env });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`codex-status-bar collector failed: ${error.message}`);
    process.exitCode = 1;
  });
}
