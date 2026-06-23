import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowPath = new URL("../.github/workflows/release.yml", import.meta.url);

async function releaseWorkflow() {
  return await readFile(workflowPath, "utf8");
}

test("release workflow can import Developer ID certificate secrets", async () => {
  const workflow = await releaseWorkflow();

  assert.match(workflow, /HAS_SIGNING_CERTIFICATE:/);
  assert.match(workflow, /CODEX_STATUS_BAR_CERTIFICATE_P12_BASE64/);
  assert.match(workflow, /Import Developer ID certificate/);
  assert.match(workflow, /security import "\$certificate_path"/);
  assert.match(workflow, /security set-key-partition-list/);
  assert.match(workflow, /CODEX_STATUS_BAR_SIGN_IDENTITY is required/);
});

test("release workflow can materialize App Store Connect notary key", async () => {
  const workflow = await releaseWorkflow();

  assert.match(workflow, /HAS_NOTARY_KEY:/);
  assert.match(workflow, /CODEX_STATUS_BAR_NOTARY_KEY_BASE64/);
  assert.match(workflow, /Materialize App Store Connect notary key/);
  assert.match(workflow, /CODEX_STATUS_BAR_NOTARY_KEY_ID is required/);
  assert.match(workflow, /CODEX_STATUS_BAR_NOTARY_ISSUER is required/);
  assert.match(workflow, /CODEX_STATUS_BAR_NOTARY_KEY=\$key_path/);
});

test("release workflow passes signing and notarization env into verification and notes", async () => {
  const workflow = await releaseWorkflow();

  const verificationBlock = workflow.match(/- name: Run full verification[\s\S]*?run: npm run verify/)?.[0] || "";
  assert.match(verificationBlock, /CODEX_STATUS_BAR_SIGN_IDENTITY/);
  assert.match(verificationBlock, /CODEX_STATUS_BAR_NOTARIZE/);
  assert.match(verificationBlock, /CODEX_STATUS_BAR_NOTARY_KEY_ID/);
  assert.match(verificationBlock, /CODEX_STATUS_BAR_NOTARY_ISSUER/);
  assert.match(verificationBlock, /CODEX_STATUS_BAR_NOTARY_APPLE_ID/);
  assert.match(verificationBlock, /CODEX_STATUS_BAR_NOTARY_PASSWORD/);
  assert.match(verificationBlock, /CODEX_STATUS_BAR_NOTARY_TEAM_ID/);

  const notesBlock = workflow.match(/- name: Create release notes[\s\S]*?release-notes\.md/)?.[0] || "";
  assert.match(notesBlock, /CODEX_STATUS_BAR_SIGN_IDENTITY/);
  assert.match(notesBlock, /CODEX_STATUS_BAR_NOTARIZE/);
});
