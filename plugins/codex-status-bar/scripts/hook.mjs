#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { open, readFile, rename, rm, stat, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";

const MAX_STDIN_BYTES = 1024 * 1024;
const MAX_STRING_LENGTH = 180;
const LOCK_RETRY_MS = 25;
const LOCK_TIMEOUT_MS = 2000;
const LOCK_STALE_MS = 10000;
const SESSION_STALE_MS = 24 * 60 * 60 * 1000;
const DETAIL_FIELDS = new Set([
  "tool_name",
  "toolName",
  "name",
  "server",
  "command",
  "matcher",
]);

export function defaultStatusRoot(env = process.env) {
  if (env.CODEX_STATUS_BAR_HOME) return path.resolve(env.CODEX_STATUS_BAR_HOME);
  return path.join(os.homedir(), ".codex", "statusbar");
}

export function defaultStatePath(env = process.env) {
  if (env.CODEX_STATUS_BAR_STATE) return path.resolve(env.CODEX_STATUS_BAR_STATE);
  return path.join(defaultStatusRoot(env), "state.json");
}

export async function readStdin(limitBytes = MAX_STDIN_BYTES) {
  return await new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    process.stdin.on("data", (chunk) => {
      size += chunk.length;
      if (size > limitBytes) {
        reject(new Error(`hook stdin exceeded ${limitBytes} bytes`));
        process.stdin.destroy();
        return;
      }
      chunks.push(chunk);
    });
    process.stdin.on("error", reject);
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

export function parseHookInput(raw) {
  if (!raw || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function safeString(value, maxLength = MAX_STRING_LENGTH) {
  if (typeof value !== "string") return null;
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) return null;
  return compact.length > maxLength ? `${compact.slice(0, maxLength - 1)}...` : compact;
}

export function shortHash(value) {
  return createHash("sha256").update(String(value)).digest("hex").slice(0, 16);
}

export function sessionIdFrom(input, env = process.env) {
  const direct =
    safeString(input.session_id, 120) ||
    safeString(input.sessionId, 120) ||
    safeString(input.conversation_id, 120) ||
    safeString(input.thread_id, 120) ||
    safeString(env.CODEX_THREAD_ID, 120) ||
    safeString(env.CODEX_SESSION_ID, 120);
  if (direct) return direct;

  const cwd = safeString(input.cwd, 500) || process.cwd();
  const transcript = safeString(input.transcript_path, 500) || "no-transcript";
  return `local-${shortHash(`${cwd}:${transcript}`)}`;
}

export function toolNameFrom(input) {
  const direct =
    safeString(input.tool_name) ||
    safeString(input.toolName) ||
    safeString(input.name) ||
    safeString(input.matcher);
  if (direct) return direct;

  const nested =
    valueAt(input, ["tool", "name"]) ||
    valueAt(input, ["tool", "toolName"]) ||
    valueAt(input, ["params", "tool"]) ||
    valueAt(input, ["params", "toolName"]);
  return safeString(nested) || "tool";
}

export function cwdFrom(input) {
  return safeString(input.cwd, 500) || safeString(input.working_directory, 500) || process.cwd();
}

export function valueAt(source, pathParts) {
  let cursor = source;
  for (const part of pathParts) {
    if (!cursor || typeof cursor !== "object" || !(part in cursor)) return undefined;
    cursor = cursor[part];
  }
  return cursor;
}

function tryJson(value) {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed || !["{", "["].includes(trimmed[0])) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function candidateObjects(input) {
  const candidates = [
    input,
    input.arguments,
    input.args,
    input.input,
    input.tool_input,
    input.toolInput,
    input.params,
    input.request,
    input.response,
  ];
  return candidates.map(tryJson).filter((item) => item && typeof item === "object");
}

export function extractProgress(input) {
  for (const candidate of candidateObjects(input)) {
    const plan = candidate.plan || candidate.steps || candidate.todos;
    if (Array.isArray(plan)) {
      const items = plan
        .map((item) => ({
          step: safeString(item.step || item.title || item.text || item.name, 120) || "Task",
          status: safeString(item.status || item.state || "pending", 40) || "pending",
        }))
        .slice(0, 20);
      if (items.length > 0) {
        const done = items.filter((item) => ["completed", "done", "complete"].includes(item.status)).length;
        return {
          label: "tasks",
          done,
          total: items.length,
          items,
          source: "tool-input",
        };
      }
    }

    const objective = candidate.objective || candidate.goal;
    const status = safeString(candidate.status || candidate.goal_status, 40);
    if (objective && status) {
      return {
        label: "goal",
        done: ["complete", "completed", "done"].includes(status) ? 1 : 0,
        total: 1,
        items: [{ step: safeString(objective, 120) || "Goal", status }],
        source: "goal-input",
      };
    }
  }
  return null;
}

export function emptyState(nowIso) {
  return {
    version: 1,
    installId: randomUUID(),
    updatedAt: nowIso,
    attention: null,
    headline: "Codex idle",
    detail: "Waiting for Codex activity",
    current: {
      status: "idle",
      event: null,
      toolName: null,
      startedAt: null,
    },
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

export function updateState(previousState, eventName, input, now = new Date(), env = process.env) {
  const nowIso = now.toISOString();
  const state = normalizeState(previousState, nowIso);
  const event = safeString(eventName || input.hook_event_name || input.event, 80) || "Unknown";
  const id = sessionIdFrom(input, env);
  const cwd = cwdFrom(input);
  const model = safeString(input.model, 80);
  const session = normalizeSession(state.sessions[id], id, cwd, nowIso);

  session.cwd = cwd;
  session.project = path.basename(cwd) || cwd;
  session.model = model || session.model || null;
  session.lastEvent = event;
  session.lastActivityAt = nowIso;
  session.updatedAt = nowIso;

  let detail = detailFromInput(input);
  let currentStatus = "thinking";
  let attention = null;
  let toolName = null;

  switch (event) {
    case "SessionStart":
      session.status = "active";
      currentStatus = "active";
      detail = `Session in ${session.project}`;
      break;
    case "UserPromptSubmit":
      session.status = "thinking";
      session.turnsStarted += 1;
      session.currentTurnStartedAt = nowIso;
      session.approvalRequired = false;
      session.progress = null;
      state.progress = null;
      currentStatus = "thinking";
      detail = `Turn ${session.turnsStarted} started`;
      break;
    case "PreToolUse":
      toolName = toolNameFrom(input);
      session.status = "running";
      session.currentTool = toolName;
      session.toolCallsStarted += 1;
      currentStatus = "running";
      detail = `Running ${toolName}`;
      break;
    case "PostToolUse":
      toolName = toolNameFrom(input);
      session.status = "thinking";
      session.currentTool = null;
      session.approvalRequired = false;
      session.toolCallsCompleted += 1;
      currentStatus = "thinking";
      detail = `Finished ${toolName}`;
      {
        const progress = extractProgress(input);
        if (progress) {
          session.progress = progress;
          state.progress = progress;
        }
      }
      break;
    case "PermissionRequest":
      toolName = toolNameFrom(input);
      session.status = "approval";
      session.currentTool = toolName;
      session.approvalRequired = true;
      currentStatus = "approval";
      attention = "approval";
      detail = `Approval needed for ${toolName}`;
      break;
    case "Stop":
      session.status = "completed";
      session.currentTool = null;
      session.approvalRequired = false;
      session.progress = null;
      session.turnsCompleted += 1;
      session.completedAt = nowIso;
      state.progress = null;
      currentStatus = "completed";
      detail = `Completed ${session.turnsCompleted} turn${session.turnsCompleted === 1 ? "" : "s"}`;
      break;
    case "PreCompact":
      session.status = "compacting";
      currentStatus = "compacting";
      detail = "Compacting context";
      break;
    case "PostCompact":
      session.status = "thinking";
      currentStatus = "thinking";
      detail = "Context compacted";
      break;
    case "SubagentStart":
      session.status = "running";
      currentStatus = "running";
      detail = "Subagent started";
      break;
    case "SubagentStop":
      session.status = "thinking";
      currentStatus = "thinking";
      detail = "Subagent completed";
      break;
    default:
      session.status = session.status === "idle" ? "active" : session.status;
      detail = detail || event;
      break;
  }

  state.sessions[id] = session;
  pruneOldSessions(state.sessions, now.getTime());
  state.updatedAt = nowIso;
  state.current = {
    status: currentStatus,
    event,
    toolName,
    startedAt: nowIso,
  };
  state.attention = attention || deriveAttention(state.sessions);
  state.aggregate = deriveAggregate(state.sessions);
  state.headline = deriveHeadline(state);
  state.detail = detail || state.detail || "Codex activity updated";
  return state;
}

function detailFromInput(input) {
  for (const field of DETAIL_FIELDS) {
    const value = safeString(input[field]);
    if (value) return value;
  }
  return null;
}

function normalizeState(state, nowIso) {
  if (!state || typeof state !== "object" || state.version !== 1) return emptyState(nowIso);
  return {
    ...emptyState(nowIso),
    ...state,
    current: { ...emptyState(nowIso).current, ...(state.current || {}) },
    aggregate: { ...emptyState(nowIso).aggregate, ...(state.aggregate || {}) },
    sessions: state.sessions && typeof state.sessions === "object" ? state.sessions : {},
  };
}

function normalizeSession(session, id, cwd, nowIso) {
  return {
    id,
    cwd,
    project: path.basename(cwd) || cwd,
    model: null,
    status: "idle",
    startedAt: nowIso,
    updatedAt: nowIso,
    lastActivityAt: nowIso,
    completedAt: null,
    currentTurnStartedAt: null,
    currentTool: null,
    lastEvent: null,
    approvalRequired: false,
    turnsStarted: 0,
    turnsCompleted: 0,
    toolCallsStarted: 0,
    toolCallsCompleted: 0,
    ...(session || {}),
  };
}

function pruneOldSessions(sessions, nowMs) {
  for (const [id, session] of Object.entries(sessions)) {
    if (!session || typeof session !== "object") {
      delete sessions[id];
      continue;
    }
    const last = Date.parse(session.lastActivityAt || session.updatedAt || session.startedAt || "");
    if (Number.isFinite(last) && nowMs - last > SESSION_STALE_MS) delete sessions[id];
  }
}

function deriveAttention(sessions) {
  return Object.values(sessions).some((session) => session.approvalRequired) ? "approval" : null;
}

function deriveAggregate(sessions) {
  const values = Object.values(sessions);
  const running = values.filter((session) =>
    ["active", "thinking", "running", "approval", "compacting"].includes(session.status)
  );
  const completed = values.filter((session) => session.status === "completed");
  const approvals = values.filter((session) => session.approvalRequired);
  const activeSince = running
    .map((session) => session.currentTurnStartedAt || session.startedAt)
    .filter(Boolean)
    .sort()[0] || null;
  return {
    runningSessions: running.length,
    completedSessions: completed.length,
    approvalsRequired: approvals.length,
    totalToolCalls: values.reduce((total, session) => total + (session.toolCallsCompleted || 0), 0),
    activeSince,
  };
}

function deriveHeadline(state) {
  if (state.aggregate.approvalsRequired > 0) return `${state.aggregate.approvalsRequired} approval needed`;
  if (state.progress && state.progress.total > 0) {
    return `${state.progress.done}/${state.progress.total} ${state.progress.label}`;
  }
  if (state.aggregate.runningSessions > 0) return `${state.aggregate.runningSessions} running`;
  if (state.aggregate.completedSessions > 0) return `${state.aggregate.completedSessions} completed`;
  return "Codex idle";
}

export async function readState(statePath) {
  try {
    const data = await readFile(statePath, "utf8");
    return JSON.parse(data);
  } catch {
    return null;
  }
}

export async function writeStateAtomic(statePath, state) {
  await mkdir(path.dirname(statePath), { recursive: true, mode: 0o700 });
  const tempPath = `${statePath}.${process.pid}.${Date.now()}.tmp`;
  const body = `${JSON.stringify(state, null, 2)}\n`;
  await writeFile(tempPath, body, { mode: 0o600 });
  await rename(tempPath, statePath);
}

export async function withStateLock(statePath, fn) {
  const lockPath = `${statePath}.lock`;
  await mkdir(path.dirname(lockPath), { recursive: true, mode: 0o700 });
  const start = Date.now();
  while (Date.now() - start <= LOCK_TIMEOUT_MS) {
    let handle = null;
    try {
      handle = await open(lockPath, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_RDWR, 0o600);
      await handle.writeFile(String(process.pid));
      try {
        return await fn();
      } finally {
        await handle.close();
        await rm(lockPath, { force: true });
      }
    } catch (error) {
      if (handle) await handle.close().catch(() => {});
      if (error && error.code !== "EEXIST") throw error;
      await removeStaleLock(lockPath);
      await sleep(LOCK_RETRY_MS);
    }
  }
  throw new Error(`timed out waiting for ${lockPath}`);
}

async function removeStaleLock(lockPath) {
  try {
    const info = await stat(lockPath);
    if (Date.now() - info.mtimeMs > LOCK_STALE_MS) await rm(lockPath, { force: true });
  } catch {
    // Lock disappeared between attempts.
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function maybeStartBootstrap(env = process.env) {
  if (env.CODEX_STATUS_BAR_NO_LAUNCH === "1") return;
  if (process.platform !== "darwin") return;
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const bootstrapPath = path.join(scriptDir, "bootstrap-app.mjs");
  const child = spawn(process.execPath, [bootstrapPath], {
    detached: true,
    stdio: "ignore",
    env,
  });
  child.unref();
}

export async function runCli(argv = process.argv, env = process.env) {
  const eventName = argv[2] || null;
  const raw = await readStdin();
  const input = parseHookInput(raw);
  const statePath = defaultStatePath(env);

  await withStateLock(statePath, async () => {
    const previous = await readState(statePath);
    const next = updateState(previous, eventName || input.hook_event_name, input, new Date(), env);
    await writeStateAtomic(statePath, next);
  });

  maybeStartBootstrap(env);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch((error) => {
    console.error(`codex-status-bar hook failed: ${error.message}`);
    process.exitCode = 1;
  });
}
