#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export function expectedTag(version) {
  return `v${version}`;
}

export function validateReleaseTag(tag, version) {
  const expected = expectedTag(version);
  if (tag !== expected) {
    throw new Error(`release tag ${JSON.stringify(tag)} must match package version ${JSON.stringify(expected)}`);
  }
}

export async function main(argv = process.argv) {
  const tag = argv[2];
  if (!tag) throw new Error("usage: node scripts/check-release-tag.mjs v0.1.1");
  const packageJson = JSON.parse(await readFile(path.join(process.cwd(), "package.json"), "utf8"));
  validateReleaseTag(tag, packageJson.version);
  console.log(`Release tag ${tag} matches package version ${packageJson.version}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
