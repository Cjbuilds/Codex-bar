import assert from "node:assert/strict";
import test from "node:test";

import {
  auditIntegrationBoundaryFiles,
  parseArgs,
  shouldScanFile,
} from "../scripts/audit-integration-boundary.mjs";

const requiredDocs = [
  {
    path: "docs/integration-boundary.md",
    text: [
      "Codex plugins document skills, apps, and MCP servers",
      "Codex hooks document command handlers for lifecycle events",
      "do not document a supported API for injecting custom items into Codex Desktop's own menu bar menu",
      "If Codex later documents a first-party app menu extension API",
    ].join("\n"),
  },
  {
    path: "README.md",
    text: [
      "No Codex.app patching",
      "Codex Bar runs as a separate native macOS menu bar item",
      "does not document a supported API for injecting custom items into Codex Desktop's own menu bar menu",
      "docs/integration-boundary.md",
    ].join("\n"),
  },
  {
    path: "SECURITY.md",
    text: [
      "The project does not patch, inject into, or modify `Codex.app`.",
      "docs/integration-boundary.md",
    ].join("\n"),
  },
  {
    path: "AGENTS.md",
    text: [
      "Do not patch, replace, or modify `Codex.app`.",
      "There is no documented public Codex plugin API for nesting this UI under Codex Desktop's own menu item.",
      "docs/integration-boundary.md",
    ].join("\n"),
  },
];

test("parseArgs supports root override", () => {
  assert.equal(parseArgs(["--root", "/tmp/codex-bar"]).root, "/tmp/codex-bar");
  assert.throws(() => parseArgs(["--unknown"]), /unknown option/);
});

test("shouldScanFile limits the audit to repo source and docs", () => {
  assert.equal(shouldScanFile("README.md"), true);
  assert.equal(shouldScanFile("plugins/codex-status-bar/app/Sources/main.swift"), true);
  assert.equal(shouldScanFile("tests/audit-integration-boundary.test.mjs"), false);
  assert.equal(shouldScanFile("plugins/codex-status-bar/assets/icon.svg"), false);
});

test("auditIntegrationBoundaryFiles accepts docs and read-only Codex bundled node reference", () => {
  const findings = auditIntegrationBoundaryFiles([
    ...requiredDocs,
    {
      path: "plugins/codex-status-bar/app/Sources/CodexStatusBar/main.swift",
      text: '"/Applications/Codex.app/Contents/Resources/cua_node/bin/node"',
    },
  ]);

  assert.deepEqual(findings, []);
});

test("auditIntegrationBoundaryFiles rejects Codex app mutation commands", () => {
  const findings = auditIntegrationBoundaryFiles([
    ...requiredDocs,
    {
      path: "scripts/install-local.mjs",
      text: 'await run("cp", ["helper", "/Applications/Codex.app/Contents/Resources/helper"]);',
    },
    {
      path: ".github/workflows/ci.yml",
      text: "run: rm -rf /Applications/Codex.app/Contents/Resources/old-plugin",
    },
  ]);

  assert.equal(findings.length, 2);
  assert.match(findings[0].message, /mutation/);
  assert.match(findings[1].message, /mutation/);
});

test("auditIntegrationBoundaryFiles requires boundary documentation", () => {
  const findings = auditIntegrationBoundaryFiles([
    { path: "README.md", text: "short" },
    { path: "SECURITY.md", text: "short" },
    { path: "AGENTS.md", text: "short" },
  ]);

  assert.ok(findings.length >= 6);
  assert.match(findings[0].message, /missing integration-boundary documentation/);
});
