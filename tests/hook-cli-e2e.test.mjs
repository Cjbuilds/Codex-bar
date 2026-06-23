import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

const hookScript = path.resolve("plugins/codex-status-bar/scripts/hook.mjs");

async function runHook(eventName, payload, env) {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [hookScript, eventName], {
      env: {
        ...process.env,
        ...env,
        CODEX_STATUS_BAR_NO_LAUNCH: "1",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`hook exited ${code}\n${stderr}`));
    });
    child.stdin.end(`${JSON.stringify(payload)}\n`);
  });
}

test("hook script writes state through the public CLI path", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "codex-status-bar-e2e-"));
  const statePath = path.join(dir, "state.json");
  try {
    const env = {
      CODEX_STATUS_BAR_STATE: statePath,
      CODEX_STATUS_BAR_HOME: dir,
    };

    await runHook("UserPromptSubmit", {
      session_id: "session-1",
      cwd: "/tmp/example",
      model: "gpt-5.5",
    }, env);

    await runHook("PreToolUse", {
      session_id: "session-1",
      cwd: "/tmp/example",
      tool_name: "Bash",
    }, env);

    const state = JSON.parse(await readFile(statePath, "utf8"));
    assert.equal(state.current.status, "running");
    assert.equal(state.current.toolName, "Bash");
    assert.equal(state.aggregate.runningSessions, 1);
    assert.equal(state.sessions["session-1"].model, "gpt-5.5");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
