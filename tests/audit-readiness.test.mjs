import assert from "node:assert/strict";
import test from "node:test";

import {
  auditReadiness,
  evaluateReadiness,
  expectedTag,
  parseArgs,
  renderReport,
} from "../scripts/audit-readiness.mjs";

const requiredFiles = [
  "LICENSE",
  "README.md",
  "SECURITY.md",
  ".agents/plugins/marketplace.json",
  ".github/workflows/ci.yml",
  ".github/workflows/release.yml",
  "plugins/codex-status-bar/.codex-plugin/plugin.json",
  "plugins/codex-status-bar/assets/icon.svg",
  "plugins/codex-status-bar/assets/preview.svg",
  "plugins/codex-status-bar/hooks/hooks.json",
  "plugins/codex-status-bar/scripts/hook.mjs",
  "plugins/codex-status-bar/scripts/collector.mjs",
  "plugins/codex-status-bar/app/Package.swift",
  "plugins/codex-status-bar/skills/codex-status-bar/SKILL.md",
];

function completeSnapshot() {
  return {
    packageJson: {
      version: "1.2.3",
      scripts: {
        "setup:codex": "node scripts/setup-codex-bar.mjs",
        "verify": "npm run test",
        "audit:readiness": "node scripts/audit-readiness.mjs",
        "validate:plugin": "node scripts/validate-plugin.mjs",
        "audit:privacy": "node scripts/audit-privacy.mjs",
        "doctor": "node scripts/doctor.mjs",
        "smoke:state": "node scripts/smoke-state.mjs",
        "smoke:render": "node scripts/smoke-render.mjs",
        "smoke:hook-render": "node scripts/smoke-hook-render.mjs",
        "smoke:snapshot": "node scripts/smoke-snapshot.mjs",
        "capture:menu": "node scripts/capture-menu-proof.mjs",
        "perf:sample": "node scripts/perf-sample.mjs",
        "package:release": "node scripts/package-release.mjs",
        "verify:published": "node scripts/verify-published-release.mjs",
      },
    },
    manifest: {
      version: "1.2.3",
      repository: "https://github.com/Cjbuilds/Codex-bar",
      license: "MIT",
      interface: {
        displayName: "Codex Bar",
        websiteURL: "https://github.com/Cjbuilds/Codex-bar",
        logo: "./assets/icon.svg",
        composerIcon: "./assets/icon.svg",
        screenshots: ["./assets/preview.svg"],
      },
    },
    marketplace: {
      plugins: [{
        name: "codex-status-bar",
        source: { path: "./plugins/codex-status-bar" },
        policy: { installation: "AVAILABLE" },
      }],
    },
    readme: [
      "codex plugin marketplace add Cjbuilds/Codex-bar",
      "npm run setup:codex",
      "npm run verify",
      "npm run smoke:snapshot",
      "npm run capture:menu",
      "npm run audit:privacy",
      "npm run perf:sample",
      "CODEX_STATUS_BAR_NOTARIZE=1",
      "not notarized yet",
      "No Codex.app patching",
      "does not store raw transcripts",
    ].join("\n"),
    security: [
      "does not persist raw Codex conversation transcripts",
      "API keys, access tokens, cookies, or passwords",
      "CODEX_STATUS_BAR_HIDE_TITLES=1",
      "npm run audit:privacy",
    ].join("\n"),
    ciWorkflow: "run: npm run verify\nuses: actions/upload-artifact@v7\n",
    releaseWorkflow: [
      "run: npm run check:release-tag",
      "run: npm run verify",
      "gh release create",
      "CODEX_STATUS_BAR_CERTIFICATE_P12_BASE64",
      "CODEX_STATUS_BAR_NOTARY_KEY_BASE64",
    ].join("\n"),
    files: Object.fromEntries(requiredFiles.map((filePath) => [filePath, true])),
  };
}

test("evaluateReadiness accepts a complete release-ready snapshot", () => {
  const result = evaluateReadiness(completeSnapshot(), {
    CODEX_STATUS_BAR_SIGN_IDENTITY: "Developer ID Application: Example (TEAMID)",
    CODEX_STATUS_BAR_NOTARIZE: "1",
  });

  assert.equal(result.ok, true);
  assert.equal(result.failures.length, 0);
  assert.equal(result.tag, "v1.2.3");
  assert.equal(result.warnings.some((warning) => warning.label.includes("clicked menu proof")), true);
  assert.equal(result.warnings.some((warning) => warning.label.includes("screenshots")), false);
});

test("evaluateReadiness fails on version drift and missing docs", () => {
  const snapshot = completeSnapshot();
  snapshot.manifest.version = "9.9.9";
  snapshot.readme = "too short";

  const result = evaluateReadiness(snapshot, {});

  assert.equal(result.ok, false);
  assert.match(renderReport(result), /plugin manifest version matches package\.json/);
  assert.match(renderReport(result), /README documents open-source install/);
});

test("parseArgs supports published release audit options", () => {
  const options = parseArgs([
    "--root", "/tmp/codex-bar",
    "--published",
    "--repo", "owner/repo",
    "--tag=v1.2.3",
    "--arch", "x64",
  ], {});

  assert.equal(options.root, "/tmp/codex-bar");
  assert.equal(options.published, true);
  assert.equal(options.repo, "owner/repo");
  assert.equal(options.tag, "v1.2.3");
  assert.equal(options.arch, "x64");
});

test("renderReport uses ASCII status markers", () => {
  const report = renderReport({
    ok: true,
    tag: "v1.2.3",
    checks: [{ label: "ready" }],
    failures: [],
    warnings: [{ label: "manual proof required" }],
    publishedRelease: {
      asset: "codex-bar-v1.2.3-macos-arm64.zip",
      sha256: "a".repeat(64),
      size: 123,
    },
  });

  assert.match(report, /\[ok\] ready/);
  assert.match(report, /\[warn\] manual proof required/);
  assert.doesNotMatch(report, /\u2713|\u2717/);
});

test("expectedTag prefixes package versions", () => {
  assert.equal(expectedTag("1.2.3"), "v1.2.3");
});

test("auditReadiness can verify the published release through an injected verifier", async () => {
  let verifierOptions = null;
  const result = await auditReadiness({
    root: process.cwd(),
    published: true,
    repo: "Cjbuilds/Codex-bar",
    tag: "v0.1.5",
    arch: "arm64",
  }, {}, async (options) => {
    verifierOptions = options;
    return {
      repo: options.repo,
      tag: options.tag,
      asset: "codex-bar-v0.1.5-macos-arm64.zip",
      sha256: "b".repeat(64),
      size: 456,
    };
  });

  assert.equal(result.ok, true);
  assert.equal(verifierOptions.root, process.cwd());
  assert.equal(result.publishedRelease.asset, "codex-bar-v0.1.5-macos-arm64.zip");
});
