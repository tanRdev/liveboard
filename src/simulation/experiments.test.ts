import { describe, it, expect } from "vitest";
import {
  ExperimentRunner,
  sameWorkload,
  experimentDefaults,
  parseExperiment,
  configFingerprint,
  percentile,
  type ExperimentSpec,
} from "./experiments";
import {
  scenario,
  executionConfig,
  parseBoard,
  serializeBoard,
} from "../board/board";
import {
  defaultBrief,
  parseBrief,
  estimateCapacity,
  capacityDefaults,
} from "../interview/interview";
import { createReportHtml } from "../interview/report";
function experiment(
  kind: Parameters<typeof scenario>[0] = "balanced",
  patch: Partial<ExperimentSpec> = {},
) {
  const runner = new ExperimentRunner(executionConfig(scenario(kind)), {
    ...experimentDefaults,
    seconds: 5,
    ...patch,
  });
  let ticks = 0;
  while (!runner.finished) {
    runner.tick();
    if (++ticks > 20000) throw new Error("Experiment did not converge");
  }
  return runner;
}
describe("Repeatable load experiments", () => {
  it("generates the exact offered load and accounts for every result after drain", () => {
    const r = experiment("balanced", { rate: 10, seconds: 15 });
    const report = r.report!;
    expect(report.offered).toBe(150);
    expect(report.completed + report.pending).toBe(150);
    expect(report.success + report.failed).toBe(report.completed);
    expect(report.series).toHaveLength(15);
    expect(r.progress()).toBe(100);
  });
  it("computes percentiles from all successful responses, beyond the recent 100", () => {
    const r = experiment("balanced", { rate: 20, seconds: 15 });
    const successful = r.results
      .filter((x) => x.status < 400)
      .map((x) => x.duration);
    expect(successful.length).toBeGreaterThan(100);
    expect(r.engine.state.results.length).toBe(100);
    expect(r.report!.p95).toBe(percentile(successful, 0.95));
    expect(r.report!.p99).toBe(percentile(successful, 0.99));
  });
  it("produces identical reports for the same configuration and workload", () => {
    expect(experiment("balanced").report).toEqual(
      experiment("balanced").report,
    );
  });
  it("schedules database outage and restores original availability without mutating input", () => {
    const config = executionConfig(scenario("balanced")),
      before = structuredClone(config);
    const r = new ExperimentRunner(config, {
      ...experimentDefaults,
      seconds: 5,
      fault: "database-outage",
      faultAt: 1,
      recoverAt: 3,
    });
    while (!r.finished) r.tick();
    expect(r.report!.timeline).toEqual([
      { second: 1, text: "database outage" },
      { second: 3, text: "Restore original availability" },
    ]);
    expect(r.engine.config.online).toBe(config.online);
    expect(config).toEqual(before);
  });
  it("restores an originally offline backend to its original state", () => {
    const b = scenario("balanced");
    b.config.backendOverrides = { backend: { online: false } };
    const r = new ExperimentRunner(executionConfig(b), {
      ...experimentDefaults,
      seconds: 3,
      fault: "backend-outage",
      faultAt: 0,
      recoverAt: 2,
    });
    while (!r.finished) r.tick();
    expect(r.engine.config.backendOverrides?.backend.online).toBe(false);
  });
  it("warms cache before measurement and excludes warm-up requests and counters", () => {
    const r = experiment("redis", { rate: 1, seconds: 3, cacheStart: "warm" });
    expect(r.report!).toMatchObject({
      offered: 3,
      success: 3,
      reads: 0,
      attempts: 0,
      hits: 3,
    });
    expect(r.results[0].id).toBeGreaterThan(1);
  });
  it("rotates only the selected seeded IDs", () => {
    const r = experiment("balanced", {
      pattern: "round-robin",
      keys: 2,
      rate: 2,
    });
    expect(new Set(r.results.map((result) => result.path))).toEqual(
      new Set(["/users/1", "/users/2"]),
    );
  });
  it("counts unfinished requests against the offered success target", () => {
    const b = scenario("cache");
    b.config.delay = 60000;
    b.config.timeout = 60000;
    b.config.queueLimit = 100;
    const r = new ExperimentRunner(executionConfig(b), {
      ...experimentDefaults,
      seconds: 2,
      rate: 10,
    });
    while (!r.finished) r.tick();
    expect(r.report!.pending).toBeGreaterThan(0);
    expect(r.report!.passed).toBe(false);
    expect(r.report!.successPercent).toBe(0);
  });
  it("captures complete failure traces and the measured configuration fingerprint", () => {
    const r = experiment("resilience", { rate: 2 });
    expect(
      r.report!.examples.some(
        (example) =>
          example.status === 503 &&
          example.trace.at(-1)?.text.includes("response received"),
      ),
    ).toBe(true);
    expect(r.report!.fingerprint).toBe(configFingerprint(r.original));
  });
  it("rejects invalid workloads and mismatched fault targets", () => {
    for (const patch of [
      { rate: 0 },
      { rate: Infinity },
      { seconds: 61 },
      { fault: "database-outage", faultAt: 3, recoverAt: 2 },
      { targetSuccess: 101 },
      { pattern: "random" },
    ])
      expect(() =>
        parseExperiment({ ...experimentDefaults, ...patch }),
      ).toThrow();
    expect(
      () =>
        new ExperimentRunner(
          executionConfig(scenario("queue")),
          experimentDefaults,
        ),
    ).toThrow(/client and backend/);
    expect(
      () =>
        new ExperimentRunner(executionConfig(scenario("database")), {
          ...experimentDefaults,
          fault: "cache-flush",
        }),
    ).toThrow(/cache/);
  });
});
describe("Interview records, capacity estimates, and exports", () => {
  it("preserves interview notes, numeric targets, capacity inputs and checkpoints in board files", () => {
    const b = scenario("balanced");
    b.interview = {
      ...structuredClone(defaultBrief),
      assumptions: "10M daily reads",
      decisions: "Choose cache-aside",
      targetSuccess: 99.9,
      checklist: ["Measure the baseline"],
    };
    expect(parseBoard(serializeBoard(b)).interview).toEqual(b.interview);
  });
  it("supplies defaults for old boards and rejects malformed interview records", () => {
    expect(parseBrief(undefined)).toEqual(defaultBrief);
    for (const patch of [
      { minutes: 0 },
      { targetP95: -1 },
      { prompt: 4 },
      { checklist: ["unsupported"] },
      { capacity: { replicas: 0 } },
      { capacity: { dailyRequests: "many" } },
    ])
      expect(() => parseBrief({ ...defaultBrief, ...patch })).toThrow();
  });
  it("calculates peak traffic, response bandwidth, and replicated storage", () => {
    const result = estimateCapacity({
      ...capacityDefaults,
      dailyRequests: 86400,
      peakFactor: 10,
      readPercent: 80,
      responseBytes: 1000,
      writesPerDay: 100,
      recordBytes: 100,
      retentionDays: 10,
      replicas: 3,
    });
    expect(result).toEqual({
      averageRps: 1,
      peakRps: 10,
      readRps: 8,
      writeRps: 2,
      egressBytesPerSecond: 10000,
      logicalStorageBytes: 100000,
      replicatedStorageBytes: 300000,
    });
  });
  it("exports a standalone report with traces and escaped user content", () => {
    const r = experiment("resilience", { rate: 2 }),
      b = scenario("resilience");
    b.nodes[0].data.name = "<script>bad()</script>";
    const html = createReportHtml(b, r.report!, {
      ...defaultBrief,
      decisions: "</pre><script>bad()</script>",
    });
    expect(html).toContain("Measured design");
    expect(html).toContain("Database attempts");
    expect(html).toContain("response received");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain("viewBox=");
  });
  it("fingerprints object keys consistently and distinguishes changed settings", () => {
    const a = executionConfig(scenario("cache"));
    expect(configFingerprint(a)).toBe(
      configFingerprint(
        Object.fromEntries(Object.entries(a).reverse()) as typeof a,
      ),
    );
    expect(configFingerprint({ ...a, ttl: 1 })).not.toBe(configFingerprint(a));
  });
});

describe("Comparable evidence", () => {
  it("compares only workload fields that affect execution", () => {
    expect(
      sameWorkload(experimentDefaults, {
        ...experimentDefaults,
        name: "Candidate",
        keys: 20,
        faultAt: 0,
        recoverAt: 1,
      }),
    ).toBe(true);
    expect(
      sameWorkload(experimentDefaults, { ...experimentDefaults, rate: 20 }),
    ).toBe(false);
    expect(
      sameWorkload(
        { ...experimentDefaults, pattern: "round-robin" },
        { ...experimentDefaults, pattern: "round-robin", keys: 20 },
      ),
    ).toBe(false);
  });
  it("does not present missing successful latency samples as zero in reports", () => {
    const r = experiment("resilience", {
      rate: 2,
      seconds: 2,
      fault: "database-outage",
      faultAt: 0,
      recoverAt: 2,
    });
    expect(r.report!.success).toBe(0);
    expect(
      createReportHtml(scenario("resilience"), r.report!, defaultBrief),
    ).toContain("No successful responses");
  });
});
