import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  appVersion,
  codesignArgs,
  plist,
  signingOptions,
} from "../plugins/codex-status-bar/scripts/package-app.mjs";
import {
  notarySubmitArgs,
  redactedCommand,
  releaseLayout,
  releaseSigningConfig,
} from "../scripts/package-release.mjs";

test("package app uses ad-hoc signing by default", () => {
  const options = signingOptions({});

  assert.deepEqual(options, {
    identity: "-",
    hardenedRuntime: false,
    requireSigning: false,
    timestamp: false,
  });
  assert.deepEqual(codesignArgs("/tmp/Codex Bar.app", options), [
    "--force",
    "--sign",
    "-",
    "/tmp/Codex Bar.app",
  ]);
});

test("Developer ID signing enables hardened runtime, timestamp, and fail-fast signing", () => {
  const options = signingOptions({
    CODEX_STATUS_BAR_SIGN_IDENTITY: "Developer ID Application: Example Corp (TEAMID1234)",
  });

  assert.equal(options.hardenedRuntime, true);
  assert.equal(options.requireSigning, true);
  assert.equal(options.timestamp, true);
  assert.deepEqual(codesignArgs("/tmp/Codex Bar.app", options), [
    "--force",
    "--sign",
    "Developer ID Application: Example Corp (TEAMID1234)",
    "--options",
    "runtime",
    "--timestamp",
    "/tmp/Codex Bar.app",
  ]);
});

test("app plist and version resolver use release metadata", async () => {
  assert.match(plist("1.2.3"), /<key>CFBundleShortVersionString<\/key>\s*<string>1\.2\.3<\/string>/);
  assert.equal(await appVersion({
    env: { CODEX_STATUS_BAR_APP_VERSION: "9.8.7" },
    root: "/missing",
  }), "9.8.7");
});

test("release notarization requires a Developer ID signing identity", () => {
  assert.throws(
    () => releaseSigningConfig({ CODEX_STATUS_BAR_NOTARIZE: "1" }),
    /requires CODEX_STATUS_BAR_SIGN_IDENTITY/
  );
});

test("release layout keeps artifact paths deterministic", () => {
  const layout = releaseLayout({
    version: "0.1.0",
    platform: "darwin",
    arch: "arm64",
    root: "/repo",
  });

  assert.equal(layout.releaseName, "codex-bar-v0.1.0-macos-arm64");
  assert.equal(layout.zipPath, path.join("/repo", "dist", "codex-bar-v0.1.0-macos-arm64.zip"));
  assert.equal(layout.appPath, path.join("/repo", "dist", "stage", "codex-bar-v0.1.0-macos-arm64", "Codex Bar.app"));
});

test("notarySubmitArgs prefers keychain profile credentials", () => {
  assert.deepEqual(notarySubmitArgs({
    archivePath: "/tmp/app.zip",
    env: {
      CODEX_STATUS_BAR_NOTARY_PROFILE: "codex-bar",
      CODEX_STATUS_BAR_NOTARY_KEYCHAIN: "/tmp/login.keychain-db",
      CODEX_STATUS_BAR_NOTARY_TIMEOUT: "45m",
    },
  }), [
    "notarytool",
    "submit",
    "/tmp/app.zip",
    "--wait",
    "--timeout",
    "45m",
    "--keychain-profile",
    "codex-bar",
    "--keychain",
    "/tmp/login.keychain-db",
  ]);
});

test("notarySubmitArgs supports App Store Connect API keys", () => {
  assert.deepEqual(notarySubmitArgs({
    archivePath: "/tmp/app.zip",
    env: {
      CODEX_STATUS_BAR_NOTARY_KEY: "/tmp/AuthKey_ABC123.p8",
      CODEX_STATUS_BAR_NOTARY_KEY_ID: "ABC123",
      CODEX_STATUS_BAR_NOTARY_ISSUER: "00000000-0000-0000-0000-000000000000",
    },
  }), [
    "notarytool",
    "submit",
    "/tmp/app.zip",
    "--wait",
    "--timeout",
    "30m",
    "--key",
    "/tmp/AuthKey_ABC123.p8",
    "--key-id",
    "ABC123",
    "--issuer",
    "00000000-0000-0000-0000-000000000000",
  ]);
});

test("notarySubmitArgs supports Apple ID credentials and rejects missing auth", () => {
  assert.deepEqual(notarySubmitArgs({
    archivePath: "/tmp/app.zip",
    env: {
      CODEX_STATUS_BAR_NOTARY_APPLE_ID: "dev@example.com",
      CODEX_STATUS_BAR_NOTARY_PASSWORD: "app-password",
      CODEX_STATUS_BAR_NOTARY_TEAM_ID: "TEAMID1234",
    },
  }), [
    "notarytool",
    "submit",
    "/tmp/app.zip",
    "--wait",
    "--timeout",
    "30m",
    "--apple-id",
    "dev@example.com",
    "--password",
    "app-password",
    "--team-id",
    "TEAMID1234",
  ]);

  assert.throws(
    () => notarySubmitArgs({ archivePath: "/tmp/app.zip", env: {} }),
    /notarization requires/
  );
});

test("redactedCommand hides secret argument values in failure messages", () => {
  assert.equal(
    redactedCommand("/usr/bin/xcrun", [
      "notarytool",
      "submit",
      "/tmp/app.zip",
      "--password",
      "app-password",
    ], ["app-password"]),
    "/usr/bin/xcrun notarytool submit /tmp/app.zip --password <redacted>"
  );
});
