#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { auditStateObject, defaultStatePath } from "./audit-privacy.mjs";
import { renderState } from "./smoke-render.mjs";

const FORBIDDEN_LABEL_SOURCES = new Set(["codex-thread-title", "codex-thread-title-excerpt", "codex-preview"]);

export function parseArgs(argv = process.argv.slice(2), env = process.env) {
  const options = {
    statePath: defaultStatePath(env),
    now: new Date().toISOString(),
    requireSession: true,
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
        options.now = nextValue();
        break;
      case "--allow-empty":
        options.requireSession = false;
        break;
      default:
        throw new Error(`unknown option ${arg}`);
    }
  }

  return options;
}

export function assertLiveRender(state, rendered, options = {}) {
  if (!state || typeof state !== "object") throw new Error("live state must be an object");
  if (!rendered || typeof rendered !== "object") throw new Error("live render must be an object");
  if (!Array.isArray(rendered.sessions)) throw new Error("live render is missing sessions");
  if (!Array.isArray(rendered.menuLines)) throw new Error("live render is missing menuLines");
  if (typeof rendered.title !== "string" || !rendered.title.startsWith("Codex")) {
    throw new Error(`live render title must start with Codex, got ${JSON.stringify(rendered.title)}`);
  }

  const stateSessions = Object.values(state.sessions || {});
  if (options.requireSession !== false && stateSessions.length === 0) {
    throw new Error("live state has no sessions; run from an active Codex setup thread or pass --allow-empty");
  }
  if (rendered.sessions.length !== stateSessions.length) {
    throw new Error(`live render session count ${rendered.sessions.length} did not match state session count ${stateSessions.length}`);
  }

  for (const [index, renderedSession] of rendered.sessions.entries()) {
    const sourceSession = stateSessions[index] || {};
    assertRenderedSession(index, sourceSession, renderedSession);
  }
}

function assertRenderedSession(index, sourceSession, renderedSession) {
  const label = `session ${index + 1}`;
  if (!renderedSession || typeof renderedSession !== "object") {
    throw new Error(`${label} render must be an object`);
  }
  if (typeof renderedSession.openURL !== "string" || !renderedSession.openURL.startsWith("codex://threads/")) {
    throw new Error(`${label} is missing a Codex deep link: ${JSON.stringify(renderedSession.openURL)}`);
  }
  const parts = String(renderedSession.title || "").split(" · ");
  if (parts.length < 4) {
    throw new Error(`${label} title must include Codex number, folder, session title, and work state: ${JSON.stringify(renderedSession.title)}`);
  }
  if (!/^Codex \d+$/.test(parts[0])) {
    throw new Error(`${label} title has invalid Codex number: ${JSON.stringify(parts[0])}`);
  }
  if (!parts[1].trim()) throw new Error(`${label} title is missing folder/project context`);
  if (!parts[2].trim()) throw new Error(`${label} title is missing session title context`);
  if (!parts.slice(3).join(" · ").trim()) throw new Error(`${label} title is missing work state`);
  if (FORBIDDEN_LABEL_SOURCES.has(sourceSession.labelSource)) {
    throw new Error(`${label} uses prompt-derived label source ${JSON.stringify(sourceSession.labelSource)}`);
  }

  const progress = sourceSession.progress;
  if (progress && Number.isFinite(progress.done) && Number.isFinite(progress.total)) {
    const expected = `${progress.done}/${progress.total}`;
    if (!renderedSession.title.includes(expected)) {
      throw new Error(`${label} progress row expected ${expected} in ${JSON.stringify(renderedSession.title)}`);
    }
  }

  if (sourceSession.approvalRequired && !renderedSession.needsAttention) {
    throw new Error(`${label} requires approval but rendered row does not need attention`);
  }
}

export async function runLiveRenderSmoke(options = parseArgs()) {
  const state = JSON.parse(await readFile(options.statePath, "utf8"));
  const findings = auditStateObject(state);
  if (findings.length > 0) {
    throw new Error(`live render state failed privacy audit:\n${findings.join("\n")}`);
  }
  const rendered = await renderState(options.statePath, options.now);
  assertLiveRender(state, rendered, { requireSession: options.requireSession });
  return {
    title: rendered.title,
    sessionCount: rendered.sessions.length,
    sessions: rendered.sessions.map((session) => session.title),
  };
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const summary = await runLiveRenderSmoke(parseArgs(argv, env));
  console.log("Codex Bar live render smoke passed");
  console.log(`title: ${summary.title}`);
  console.log(`sessions: ${summary.sessionCount}`);
  for (const session of summary.sessions) console.log(`- ${session}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
