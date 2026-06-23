import assert from "node:assert/strict";
import test from "node:test";

import {
  captureFailureMessage,
  parseArgs,
  preflightScreenshotArgs,
  screenshotArgs,
} from "../scripts/capture-menu-proof.mjs";

test("parseArgs supports manual menu capture controls", () => {
  const options = parseArgs([
    "--output",
    "/tmp/codex-bar-proof.png",
    "--delay-seconds=3",
    "--phase-ms",
    "2500",
    "--settle-ms=750",
    "--no-demo",
    "--no-preflight",
  ]);

  assert.equal(options.output, "/tmp/codex-bar-proof.png");
  assert.equal(options.delaySeconds, 3);
  assert.equal(options.phaseMs, 2500);
  assert.equal(options.settleMs, 750);
  assert.equal(options.demo, false);
  assert.equal(options.preflight, false);
});

test("parseArgs preflights Screen Recording by default", () => {
  assert.equal(parseArgs([]).preflight, true);
});

test("parseArgs rejects invalid or incomplete capture options", () => {
  assert.throws(() => parseArgs(["--delay-seconds", "0"]), /positive number/);
  assert.throws(() => parseArgs(["--phase-ms", "nope"]), /positive number/);
  assert.throws(() => parseArgs(["--output"]), /requires a value/);
  assert.throws(() => parseArgs(["--output", "--no-demo"]), /requires a value/);
  assert.throws(() => parseArgs(["--bogus"]), /unknown option/);
});

test("screenshotArgs uses quiet delayed PNG capture", () => {
  assert.deepEqual(
    screenshotArgs({ delaySeconds: 3, output: "/tmp/codex-bar-proof.png" }),
    ["-x", "-T", "3", "/tmp/codex-bar-proof.png"]
  );
});

test("preflightScreenshotArgs uses immediate quiet PNG capture", () => {
  assert.deepEqual(
    preflightScreenshotArgs("/tmp/codex-bar-preflight.png"),
    ["-x", "/tmp/codex-bar-preflight.png"]
  );
});

test("captureFailureMessage explains macOS Screen Recording permission failures", () => {
  const message = captureFailureMessage({
    code: 1,
    stdout: "",
    stderr: "could not create image from display",
  });

  assert.match(message, /macOS blocked screen capture/);
  assert.match(message, /Screen Recording/);
  assert.match(message, /Privacy & Security/);
});
