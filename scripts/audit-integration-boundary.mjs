#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";

const DEFAULT_ALLOWED_CODEX_APP_PATHS = [
  "/Applications/Codex.app/Contents/Resources/cua_node/bin/node",
];

const REQUIRED_DOC_SNIPPETS = {
  "docs/integration-boundary.md": [
    "Codex plugins document skills, apps, and MCP servers",
    "Codex hooks document command handlers for lifecycle events",
    "do not document a supported API for injecting custom items into Codex Desktop's own menu bar menu",
    "If Codex later documents a first-party app menu extension API",
  ],
  "README.md": [
    "No Codex.app patching",
    "Codex Bar runs as a separate native macOS menu bar item",
    "does not document a supported API for injecting custom items into Codex Desktop's own menu bar menu",
    "docs/integration-boundary.md",
  ],
  "SECURITY.md": [
    "does not patch, inject into, or modify `Codex.app`",
    "docs/integration-boundary.md",
  ],
  "AGENTS.md": [
    "Do not patch, replace, or modify `Codex.app`.",
    "There is no documented public Codex plugin API for nesting this UI under Codex Desktop's own menu item.",
    "docs/integration-boundary.md",
  ],
};

const SCANNED_EXTENSIONS = new Set([
  ".json",
  ".js",
  ".mjs",
  ".md",
  ".swift",
  ".toml",
  ".txt",
  ".yml",
  ".yaml",
]);

const SKIPPED_PREFIXES = [
  "tests/",
];

const MUTATION_COMMAND_PATTERN = /\b(cp|mv|rm|ditto|rsync|install|chmod|chown|xattr|codesign|plutil|defaults|sed|perl|python3?|node|osascript)\b/;
const MUTATION_WORD_PATTERN = /\b(patch|replace|modify|inject|rewrite|overwrite|delete|remove|copy|move|sign)\b/i;

function run(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      ...options,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("error", (error) => resolve({ code: 127, stdout, stderr: error.message }));
    child.on("exit", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

export function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    root: process.cwd(),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const [key, inlineValue] = arg.split("=", 2);
    const nextValue = () => inlineValue ?? argv[++index];
    switch (key) {
      case "--root":
        options.root = path.resolve(nextValue());
        break;
      default:
        throw new Error(`unknown option ${arg}`);
    }
  }

  return options;
}

export function shouldScanFile(filePath) {
  if (SKIPPED_PREFIXES.some((prefix) => filePath.startsWith(prefix))) return false;
  return SCANNED_EXTENSIONS.has(path.extname(filePath));
}

export function auditIntegrationBoundaryFiles(files, options = {}) {
  const allowedCodexAppPaths = options.allowedCodexAppPaths || DEFAULT_ALLOWED_CODEX_APP_PATHS;
  const findings = [];
  const byPath = new Map(files.map((file) => [file.path, file.text]));

  for (const [filePath, snippets] of Object.entries(REQUIRED_DOC_SNIPPETS)) {
    const text = byPath.get(filePath) || "";
    for (const snippet of snippets) {
      if (!text.includes(snippet)) {
        findings.push({
          path: filePath,
          line: 1,
          message: `missing integration-boundary documentation: ${JSON.stringify(snippet)}`,
        });
      }
    }
  }

  for (const file of files) {
    if (!shouldScanFile(file.path)) continue;
    const lines = file.text.split(/\r?\n/);
    lines.forEach((line, index) => {
      const lineNumber = index + 1;
      if (!mentionsCodexAppTarget(line)) return;
      if (isAllowedReadOnlyReference(line, allowedCodexAppPaths)) return;
      if (isDocumentationBoundaryLine(line)) return;
      if (!looksLikeMutation(line)) return;

      findings.push({
        path: file.path,
        line: lineNumber,
        message: "potential Codex.app mutation or injection target",
      });
    });
  }

  return findings;
}

function mentionsCodexAppTarget(line) {
  return /Codex\.app|\/Applications\/Codex|com\.openai\.codex/i.test(line);
}

function isAllowedReadOnlyReference(line, allowedCodexAppPaths) {
  const trimmed = line.trim();
  return allowedCodexAppPaths.some((allowedPath) =>
    trimmed.includes(allowedPath) && !MUTATION_COMMAND_PATTERN.test(trimmed.replace(allowedPath, ""))
  );
}

function isDocumentationBoundaryLine(line) {
  return /do not|does not|avoids unsupported|separate native|no documented public|not document a supported API|no Codex\.app patching/i.test(line);
}

function looksLikeMutation(line) {
  const trimmed = line.trim();
  if (MUTATION_COMMAND_PATTERN.test(trimmed)) return true;
  return MUTATION_WORD_PATTERN.test(trimmed) && /Codex\.app|com\.openai\.codex/i.test(trimmed);
}

async function gitVisibleFiles(root) {
  const result = await run("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: root });
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || "git ls-files failed");
  }
  return result.stdout.split("\0").filter(Boolean).filter(shouldScanFile);
}

export async function readAuditFiles(root) {
  const paths = await gitVisibleFiles(root);
  return await Promise.all(paths.map(async (filePath) => ({
    path: filePath,
    text: await readFile(path.join(root, filePath), "utf8"),
  })));
}

export async function runIntegrationBoundaryAudit(options = parseArgs()) {
  const files = await readAuditFiles(options.root);
  const findings = auditIntegrationBoundaryFiles(files);
  return { ok: findings.length === 0, findings };
}

export async function main(argv = process.argv.slice(2)) {
  const result = await runIntegrationBoundaryAudit(parseArgs(argv));
  if (result.ok) {
    console.log("Codex Bar integration boundary audit passed");
    return;
  }

  console.error("Codex Bar integration boundary audit failed:");
  for (const finding of result.findings) {
    console.error(`- ${finding.path}:${finding.line} ${finding.message}`);
  }
  process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
