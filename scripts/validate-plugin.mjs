#!/usr/bin/env node
import { access, readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const PLUGIN_ROOT = path.join(ROOT, "plugins", "codex-status-bar");
const MANIFEST_PATH = path.join(PLUGIN_ROOT, ".codex-plugin", "plugin.json");
const MARKETPLACE_PATH = path.join(ROOT, ".agents", "plugins", "marketplace.json");
const HOOKS_PATH = path.join(PLUGIN_ROOT, "hooks", "hooks.json");

const SUPPORTED_HOOK_EVENTS = new Set([
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PermissionRequest",
  "PostToolUse",
  "PreCompact",
  "PostCompact",
  "SubagentStart",
  "SubagentStop",
  "Stop",
]);

const failures = [];

function fail(message) {
  failures.push(message);
}

async function readJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    fail(`${path.relative(ROOT, filePath)} is not readable JSON: ${error.message}`);
    return null;
  }
}

async function mustExist(filePath) {
  try {
    await access(filePath);
  } catch {
    fail(`${path.relative(ROOT, filePath)} is missing`);
  }
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) fail(`${label} expected ${JSON.stringify(expected)} but got ${JSON.stringify(actual)}`);
}

function assertMatch(value, pattern, label) {
  if (typeof value !== "string" || !pattern.test(value)) {
    fail(`${label} expected to match ${pattern} but got ${JSON.stringify(value)}`);
  }
}

function assertNoLegacyBrandText(label, value) {
  if (typeof value === "string" && value.includes("Codex Status Bar")) {
    fail(`${label} still contains legacy product name "Codex Status Bar"`);
  }
}

function inspectObjectStrings(label, value) {
  if (typeof value === "string") {
    assertNoLegacyBrandText(label, value);
    if (value.includes("[TODO:")) fail(`${label} contains TODO placeholder`);
    return;
  }
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => inspectObjectStrings(`${label}[${index}]`, item));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    inspectObjectStrings(`${label}.${key}`, child);
  }
}

function validateManifest(manifest) {
  if (!manifest) return;
  assertEqual(manifest.name, "codex-status-bar", "manifest.name");
  assertMatch(manifest.version, /^\d+\.\d+\.\d+$/, "manifest.version");
  assertEqual(manifest.homepage, "https://github.com/Cjbuilds/Codex-bar", "manifest.homepage");
  assertEqual(manifest.repository, "https://github.com/Cjbuilds/Codex-bar", "manifest.repository");
  assertEqual(manifest.license, "MIT", "manifest.license");
  assertEqual(manifest.skills, "./skills/", "manifest.skills");
  assertEqual(manifest.interface?.displayName, "Codex Bar", "manifest.interface.displayName");
  assertEqual(manifest.interface?.websiteURL, "https://github.com/Cjbuilds/Codex-bar", "manifest.interface.websiteURL");
  assertEqual(manifest.interface?.category, "Productivity", "manifest.interface.category");
  if (!Array.isArray(manifest.interface?.capabilities)) fail("manifest.interface.capabilities must be an array");
  inspectObjectStrings("manifest", manifest);
}

function validateMarketplace(marketplace) {
  if (!marketplace) return;
  assertEqual(marketplace.name, "codex-bar", "marketplace.name");
  assertEqual(marketplace.interface?.displayName, "Codex Bar", "marketplace.interface.displayName");
  const plugin = marketplace.plugins?.find((entry) => entry.name === "codex-status-bar");
  if (!plugin) {
    fail("marketplace.plugins must include codex-status-bar");
    return;
  }
  assertEqual(plugin.source?.source, "local", "marketplace plugin source");
  assertEqual(plugin.source?.path, "./plugins/codex-status-bar", "marketplace plugin path");
  assertEqual(plugin.policy?.installation, "AVAILABLE", "marketplace plugin installation policy");
  assertEqual(plugin.policy?.authentication, "ON_INSTALL", "marketplace plugin authentication policy");
}

function validateHooks(hooksFile) {
  if (!hooksFile?.hooks || typeof hooksFile.hooks !== "object") {
    fail("hooks.json must contain a hooks object");
    return;
  }
  for (const eventName of Object.keys(hooksFile.hooks)) {
    if (!SUPPORTED_HOOK_EVENTS.has(eventName)) fail(`unsupported hook event ${eventName}`);
  }
  for (const eventName of SUPPORTED_HOOK_EVENTS) {
    if (!Array.isArray(hooksFile.hooks[eventName])) fail(`missing hook event ${eventName}`);
  }
  for (const [eventName, matchers] of Object.entries(hooksFile.hooks)) {
    for (const [matcherIndex, matcher] of matchers.entries()) {
      const hooks = matcher.hooks;
      if (!Array.isArray(hooks) || hooks.length === 0) {
        fail(`${eventName}[${matcherIndex}] has no hooks`);
        continue;
      }
      for (const [hookIndex, hook] of hooks.entries()) {
        const prefix = `${eventName}[${matcherIndex}].hooks[${hookIndex}]`;
        assertEqual(hook.type, "command", `${prefix}.type`);
        if (!hook.command?.includes('node "$PLUGIN_ROOT/scripts/hook.mjs"')) {
          fail(`${prefix}.command must call hook.mjs through PLUGIN_ROOT`);
        }
        if (!Number.isFinite(hook.timeout) || hook.timeout > 10) {
          fail(`${prefix}.timeout must be finite and at most 10 seconds`);
        }
        assertEqual(hook.statusMessage, "Updating Codex Bar", `${prefix}.statusMessage`);
      }
    }
  }
}

await Promise.all([
  mustExist(path.join(PLUGIN_ROOT, "scripts", "hook.mjs")),
  mustExist(path.join(PLUGIN_ROOT, "scripts", "collector.mjs")),
  mustExist(path.join(PLUGIN_ROOT, "scripts", "bootstrap-app.mjs")),
  mustExist(path.join(PLUGIN_ROOT, "scripts", "package-app.mjs")),
  mustExist(path.join(PLUGIN_ROOT, "app", "Package.swift")),
  mustExist(path.join(PLUGIN_ROOT, "skills", "codex-status-bar", "SKILL.md")),
]);

validateManifest(await readJson(MANIFEST_PATH));
validateMarketplace(await readJson(MARKETPLACE_PATH));
validateHooks(await readJson(HOOKS_PATH));

if (failures.length > 0) {
  console.error("Codex Bar validation failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log("Codex Bar validation passed");
}
