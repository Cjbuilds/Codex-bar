#!/usr/bin/env node
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { verifyPublishedRelease } from "./verify-published-release.mjs";

const DEFAULT_REPO = "Cjbuilds/Codex-bar";

const REQUIRED_FILES = [
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

const REQUIRED_SCRIPTS = [
  "setup:codex",
  "verify",
  "audit:readiness",
  "validate:plugin",
  "audit:privacy",
  "doctor",
  "smoke:state",
  "smoke:render",
  "smoke:hook-render",
  "smoke:snapshot",
  "capture:menu",
  "perf:sample",
  "package:release",
  "verify:published",
];

const README_SNIPPETS = [
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
];

const SECURITY_SNIPPETS = [
  "does not persist raw Codex conversation transcripts",
  "API keys, access tokens, cookies, or passwords",
  "CODEX_STATUS_BAR_HIDE_TITLES=1",
  "npm run audit:privacy",
];

function includesAll(text, snippets) {
  return snippets.filter((snippet) => !text.includes(snippet));
}

function scriptCommand(scripts, name) {
  const command = scripts?.[name];
  return typeof command === "string" && command.trim() ? command : null;
}

function workflowHas(workflow, snippet) {
  return typeof workflow === "string" && workflow.includes(snippet);
}

function addCheck(results, ok, label, detail = null) {
  const item = { label, detail };
  if (ok) results.checks.push(item);
  else results.failures.push(item);
}

export function expectedTag(version) {
  return `v${version}`;
}

export function evaluateReadiness(snapshot, env = process.env) {
  const results = { checks: [], failures: [], warnings: [] };
  const packageJson = snapshot.packageJson || {};
  const manifest = snapshot.manifest || {};
  const marketplace = snapshot.marketplace || {};
  const scripts = packageJson.scripts || {};
  const version = packageJson.version;

  addCheck(results, Boolean(version), "package.json has a version");
  addCheck(results, manifest.version === version, "plugin manifest version matches package.json", `${manifest.version || "missing"} vs ${version || "missing"}`);
  addCheck(results, manifest.repository === DEFAULT_REPO || manifest.repository === `https://github.com/${DEFAULT_REPO}`, "plugin manifest points at the public GitHub repo");
  addCheck(results, manifest.license === "MIT", "plugin manifest declares MIT license");
  addCheck(results, manifest.interface?.displayName === "Codex Bar", "plugin display name is Codex Bar");
  addCheck(results, manifest.interface?.websiteURL === `https://github.com/${DEFAULT_REPO}`, "plugin website points at GitHub repo");
  addCheck(results, manifest.interface?.logo === "./assets/icon.svg", "plugin manifest declares a local logo asset");
  addCheck(results, manifest.interface?.composerIcon === "./assets/icon.svg", "plugin manifest declares a local composer icon asset");
  addCheck(
    results,
    Array.isArray(manifest.interface?.screenshots) && manifest.interface.screenshots.includes("./assets/preview.svg"),
    "plugin manifest declares a local preview screenshot"
  );

  const marketplaceEntry = marketplace.plugins?.find((plugin) => plugin.name === "codex-status-bar");
  addCheck(results, Boolean(marketplaceEntry), "local marketplace contains codex-status-bar");
  addCheck(results, marketplaceEntry?.source?.path === "./plugins/codex-status-bar", "marketplace entry points at plugin folder");
  addCheck(results, marketplaceEntry?.policy?.installation === "AVAILABLE", "marketplace entry is available for installation");

  for (const filePath of REQUIRED_FILES) {
    addCheck(results, Boolean(snapshot.files?.[filePath]), `${filePath} exists`);
  }

  for (const name of REQUIRED_SCRIPTS) {
    addCheck(results, Boolean(scriptCommand(scripts, name)), `package script ${name} exists`);
  }

  addCheck(results, workflowHas(snapshot.ciWorkflow, "npm run verify"), "CI workflow runs npm run verify");
  addCheck(results, workflowHas(snapshot.ciWorkflow, "actions/upload-artifact"), "CI workflow uploads release and snapshot artifacts");
  addCheck(results, workflowHas(snapshot.releaseWorkflow, "npm run check:release-tag"), "release workflow checks tag/version alignment");
  addCheck(results, workflowHas(snapshot.releaseWorkflow, "npm run verify"), "release workflow runs full verification");
  addCheck(results, workflowHas(snapshot.releaseWorkflow, "gh release"), "release workflow publishes GitHub Release assets");
  addCheck(results, workflowHas(snapshot.releaseWorkflow, "CODEX_STATUS_BAR_CERTIFICATE_P12_BASE64"), "release workflow supports Developer ID certificate import");
  addCheck(results, workflowHas(snapshot.releaseWorkflow, "CODEX_STATUS_BAR_NOTARY_KEY_BASE64"), "release workflow supports App Store Connect notarization key import");

  for (const missing of includesAll(snapshot.readme || "", README_SNIPPETS)) {
    addCheck(results, false, "README documents open-source install, verification, privacy, and release workflow", `missing ${JSON.stringify(missing)}`);
  }
  if (includesAll(snapshot.readme || "", README_SNIPPETS).length === 0) {
    addCheck(results, true, "README documents open-source install, verification, privacy, and release workflow");
  }

  for (const missing of includesAll(snapshot.security || "", SECURITY_SNIPPETS)) {
    addCheck(results, false, "SECURITY.md documents minimized local state and privacy escape hatch", `missing ${JSON.stringify(missing)}`);
  }
  if (includesAll(snapshot.security || "", SECURITY_SNIPPETS).length === 0) {
    addCheck(results, true, "SECURITY.md documents minimized local state and privacy escape hatch");
  }

  if (!env.CODEX_STATUS_BAR_SIGN_IDENTITY || !env.CODEX_STATUS_BAR_NOTARIZE) {
    results.warnings.push({
      label: "public release is expected to be ad-hoc signed unless signing/notary env vars are set",
      detail: "Set CODEX_STATUS_BAR_SIGN_IDENTITY and CODEX_STATUS_BAR_NOTARIZE=1 with notarization credentials for a notarized artifact.",
    });
  }

  results.warnings.push({
    label: "real clicked menu proof still requires local macOS Screen Recording permission",
    detail: "Run npm run capture:menu on a permitted terminal to produce dist/visual-proof/codex-bar-menu-proof.png.",
  });

  return { ...results, ok: results.failures.length === 0, tag: version ? expectedTag(version) : null };
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function readReadinessSnapshot(root = process.cwd()) {
  const files = {};
  for (const filePath of REQUIRED_FILES) {
    files[filePath] = await exists(path.join(root, filePath));
  }

  return {
    packageJson: await readJson(path.join(root, "package.json")),
    manifest: await readJson(path.join(root, "plugins/codex-status-bar/.codex-plugin/plugin.json")),
    marketplace: await readJson(path.join(root, ".agents/plugins/marketplace.json")),
    readme: await readFile(path.join(root, "README.md"), "utf8"),
    security: await readFile(path.join(root, "SECURITY.md"), "utf8"),
    ciWorkflow: await readFile(path.join(root, ".github/workflows/ci.yml"), "utf8"),
    releaseWorkflow: await readFile(path.join(root, ".github/workflows/release.yml"), "utf8"),
    files,
  };
}

export function parseArgs(argv = process.argv.slice(2), env = process.env) {
  const options = {
    root: process.cwd(),
    published: false,
    repo: env.CODEX_BAR_RELEASE_REPO || DEFAULT_REPO,
    tag: env.RELEASE_TAG || null,
    arch: env.CODEX_STATUS_BAR_RELEASE_ARCH || process.arch,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const [key, inlineValue] = arg.split("=", 2);
    const nextValue = () => inlineValue ?? argv[++index];
    switch (key) {
      case "--root":
        options.root = path.resolve(nextValue());
        break;
      case "--published":
        options.published = true;
        break;
      case "--repo":
        options.repo = nextValue();
        break;
      case "--tag":
        options.tag = nextValue();
        break;
      case "--arch":
        options.arch = nextValue();
        break;
      default:
        throw new Error(`unknown option ${arg}`);
    }
  }

  return options;
}

export function renderReport(result) {
  const lines = [result.ok ? "Codex Bar release readiness passed" : "Codex Bar release readiness failed"];
  if (result.tag) lines.push(`Tag: ${result.tag}`);
  lines.push("");
  lines.push("Checks:");
  for (const check of result.checks) {
    lines.push(`[ok] ${check.label}${check.detail ? ` (${check.detail})` : ""}`);
  }
  for (const failure of result.failures) {
    lines.push(`[fail] ${failure.label}${failure.detail ? ` (${failure.detail})` : ""}`);
  }
  if (result.publishedRelease) {
    lines.push("");
    lines.push("Published release:");
    lines.push(`[ok] ${result.publishedRelease.asset}`);
    lines.push(`[ok] SHA-256 ${result.publishedRelease.sha256}`);
    lines.push(`[ok] ${result.publishedRelease.size} bytes`);
  }
  if (result.warnings.length > 0) {
    lines.push("");
    lines.push("Warnings:");
    for (const warning of result.warnings) {
      lines.push(`[warn] ${warning.label}${warning.detail ? ` (${warning.detail})` : ""}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

export async function auditReadiness(options = parseArgs(), env = process.env, publishedVerifier = verifyPublishedRelease) {
  const result = evaluateReadiness(await readReadinessSnapshot(options.root), env);
  if (options.published) {
    result.publishedRelease = await publishedVerifier({
      root: options.root,
      repo: options.repo,
      tag: options.tag || result.tag,
      version: result.tag?.replace(/^v/, ""),
      arch: options.arch,
      outputDir: null,
      keep: false,
    });
  }
  return result;
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const result = await auditReadiness(parseArgs(argv, env), env);
  process.stdout.write(renderReport(result));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
