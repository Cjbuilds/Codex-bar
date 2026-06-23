import assert from "node:assert/strict";
import test from "node:test";

import { runSmokeHookRender } from "../scripts/smoke-hook-render.mjs";

test("hook render smoke exercises public approval hook through native formatter", async () => {
  const result = await runSmokeHookRender();

  assert.deepEqual(result, {
    approvalTitle: "Codex · !",
    progressTitle: "Codex · 2/3",
  });
});
