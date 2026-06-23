import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateSummary,
  parseArgs,
  parsePsLine,
  summarizeSamples,
} from "../scripts/perf-sample.mjs";

test("parsePsLine reads process metrics and command", () => {
  const sample = parsePsLine("36947     1   0.2  0.3  67472 07:40 /tmp/CodexStatusBar", "app");

  assert.equal(sample.label, "app");
  assert.equal(sample.pid, 36947);
  assert.equal(sample.ppid, 1);
  assert.equal(sample.cpu, 0.2);
  assert.equal(sample.memory, 0.3);
  assert.equal(sample.rssKb, 67472);
  assert.equal(sample.elapsed, "07:40");
  assert.equal(sample.command, "/tmp/CodexStatusBar");
});

test("summarizeSamples computes average and maximum metrics", () => {
  const summary = summarizeSamples([
    { label: "app", pid: 1, cpu: 0, rssKb: 1024, command: "app" },
    { label: "app", pid: 1, cpu: 2, rssKb: 2048, command: "app" },
    { label: "collector", pid: 2, cpu: 4, rssKb: 4096, command: "node collector" },
  ]);

  assert.equal(summary.app.averageCpu, 1);
  assert.equal(summary.app.maxCpu, 2);
  assert.equal(summary.app.averageRssMb, 1.5);
  assert.equal(summary.collector.averageCpu, 4);
});

test("evaluateSummary reports CPU and RSS threshold failures", () => {
  const failures = evaluateSummary({
    app: { averageCpu: 6, maxRssMb: 100 },
    collector: { averageCpu: 11, maxRssMb: 600 },
  }, {
    maxAppAverageCpu: 5,
    maxCollectorAverageCpu: 10,
    maxRssMb: 512,
  });

  assert.deepEqual(failures, [
    "app average CPU 6% exceeded 5%",
    "collector average CPU 11% exceeded 10%",
    "collector max RSS 600 MiB exceeded 512 MiB",
  ]);
});

test("parseArgs supports thresholds and JSON output", () => {
  const options = parseArgs([
    "--duration-ms", "5000",
    "--interval-ms=1000",
    "--max-app-average-cpu", "3",
    "--max-collector-average-cpu=4",
    "--max-rss-mb", "256",
    "--json",
  ]);

  assert.equal(options.durationMs, 5000);
  assert.equal(options.intervalMs, 1000);
  assert.equal(options.maxAppAverageCpu, 3);
  assert.equal(options.maxCollectorAverageCpu, 4);
  assert.equal(options.maxRssMb, 256);
  assert.equal(options.json, true);
});
