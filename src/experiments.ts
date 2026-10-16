import {
  Engine,
  backendSettings,
  components,
  type Config,
  type Result,
  type Trace,
} from "./engine";
export type ExperimentSpec = {
  name: string;
  path: string;
  rate: number;
  seconds: number;
  pattern: "hot-key" | "round-robin";
  keys: number;
  cacheStart: "cold" | "warm";
  fault:
    | "none"
    | "database-outage"
    | "cache-outage"
    | "backend-outage"
    | "cache-flush";
  faultAt: number;
  recoverAt: number;
  targetSuccess: number;
  targetP95: number;
};
export const experimentDefaults: ExperimentSpec = {
  name: "Baseline",
  path: "/users/1",
  rate: 10,
  seconds: 15,
  pattern: "hot-key",
  keys: 2,
  cacheStart: "cold",
  fault: "none",
  faultAt: 5,
  recoverAt: 10,
  targetSuccess: 99,
  targetP95: 1000,
};
export type ExperimentPoint = {
  second: number;
  sent: number;
  success: number;
  failed: number;
  queued: number;
  active: number;
  cacheHits: number;
  reads: number;
};
export type ExperimentReport = {
  spec: ExperimentSpec;
  fingerprint: string;
  offered: number;
  completed: number;
  success: number;
  failed: number;
  pending: number;
  successPercent: number;
  p50: number;
  p95: number;
  p99: number;
  averageWait: number;
  reads: number;
  hits: number;
  misses: number;
  peakQueue: number;
  attempts: number;
  retries: number;
  blocked: number;
  drainMs: number;
  statuses: Record<string, number>;
  series: ExperimentPoint[];
  examples: { id: number; status: number; duration: number; trace: Trace[] }[];
  timeline: { second: number; text: string }[];
  passed: boolean;
};
export function parseExperiment(value: unknown): ExperimentSpec {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid experiment.");
  const raw = value as Record<string, unknown>,
    spec = { ...experimentDefaults };
  for (const key of ["name", "path"] as const) {
    if (
      typeof raw[key] !== "string" ||
      raw[key].length > 200 ||
      !raw[key].trim()
    )
      throw new Error(`Invalid experiment ${key}.`);
    spec[key] = raw[key];
  }
  if (!spec.path.startsWith("/"))
    throw new Error("Request paths must start with /.");
  for (const [key, min, max] of [
    ["rate", 1, 100],
    ["seconds", 1, 60],
    ["keys", 1, 100],
    ["faultAt", 0, 60],
    ["recoverAt", 0, 60],
    ["targetSuccess", 0, 100],
    ["targetP95", 1, 60000],
  ] as const) {
    const v = raw[key];
    if (
      typeof v !== "number" ||
      !Number.isFinite(v) ||
      v < min ||
      v > max ||
      (key !== "targetSuccess" && !Number.isInteger(v))
    )
      throw new Error(`Invalid experiment ${key}.`);
    spec[key] = v;
  }
  for (const [key, choices] of [
    ["pattern", ["hot-key", "round-robin"]],
    ["cacheStart", ["cold", "warm"]],
    [
      "fault",
      [
        "none",
        "database-outage",
        "cache-outage",
        "backend-outage",
        "cache-flush",
      ],
    ],
  ] as const) {
    if (!choices.some((v) => v === raw[key]))
      throw new Error(`Invalid experiment ${key}.`);
    Object.assign(spec, { [key]: raw[key] });
  }
  if (
    spec.fault !== "none" &&
    (spec.faultAt >= spec.seconds ||
      (spec.fault !== "cache-flush" &&
        (spec.recoverAt <= spec.faultAt || spec.recoverAt > spec.seconds)))
  )
    throw new Error(
      "Place the failure and recovery inside the experiment, with recovery after failure.",
    );
  return spec;
}
export function sameWorkload(a: ExperimentSpec, b: ExperimentSpec) {
  if (
    !(
      ["path", "rate", "seconds", "pattern", "cacheStart", "fault"] as const
    ).every((key) => a[key] === b[key])
  )
    return false;
  if (a.pattern === "round-robin" && a.keys !== b.keys) return false;
  if (a.fault !== "none" && a.faultAt !== b.faultAt) return false;
  return (
    a.fault === "none" ||
    a.fault === "cache-flush" ||
    a.recoverAt === b.recoverAt
  );
}
export function configFingerprint(config: Config) {
  let hash = 2166136261;
  const stable = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(stable)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, v]) => [k, stable(v)]),
          )
        : value;
  for (const char of JSON.stringify(stable(config)))
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(16).padStart(8, "0");
}
export function percentile(values: number[], p: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)];
}
export class ExperimentRunner {
  engine: Engine;
  firstBackend: string;
  spec: ExperimentSpec;
  original: Config;
  results: Result[] = [];
  series: ExperimentPoint[] = [];
  timeline: { second: number; text: string }[] = [];
  firstId = Infinity;
  start = 0;
  arrival = 0;
  nextSample = 1000;
  failedAt = false;
  recovered = false;
  finished = false;
  offered = 0;
  warmIds: string[];
  warmIndex = 0;
  phase: "warmup" | "measure" | "drain" | "done";
  drainStart = 0;
  initial = {
    reads: 0,
    hits: 0,
    misses: 0,
    attempts: 0,
    retries: 0,
    blocked: 0,
  };
  report?: ExperimentReport;
  constructor(config: Config, spec: ExperimentSpec) {
    this.spec = parseExperiment(spec);
    this.original = structuredClone(config);
    const backend = components(config).find((c) => c.role === "backend");
    if (!backend || !components(config).some((c) => c.role === "client"))
      throw new Error("Add a client and backend to run an HTTP experiment.");
    this.firstBackend = backend.id;
    if (
      this.spec.fault === "cache-outage" ||
      this.spec.fault === "cache-flush"
    ) {
      if (!components(config).some((c) => c.role === "cache"))
        throw new Error("This failure experiment needs a cache.");
    }
    if (
      this.spec.fault === "database-outage" &&
      !components(config).some((c) => c.role === "database")
    )
      throw new Error("This failure experiment needs a database.");
    this.engine = new Engine((result) => {
      if (result.id >= this.firstId) this.results.push(structuredClone(result));
    });
    this.engine.configure(this.original);
    this.warmIds = this.ids();
    this.phase = this.spec.cacheStart === "warm" ? "warmup" : "measure";
    if (this.phase === "measure") this.begin();
  }
  ids() {
    return Object.keys(this.original.records)
      .sort((a, b) => Number(a) - Number(b))
      .slice(0, this.spec.pattern === "hot-key" ? 1 : this.spec.keys);
  }
  path(index: number) {
    const ids = this.ids();
    if (this.spec.pattern === "hot-key" || !ids.length) return this.spec.path;
    return this.spec.path.replace(/[^/]+$/, ids[index % ids.length]);
  }
  begin() {
    this.start = this.engine.state.now;
    this.firstId = this.engine.nextId;
    const circuits = Object.values(this.engine.state.circuits);
    this.initial = {
      reads: this.engine.state.reads,
      hits: this.engine.state.hits,
      misses: this.engine.state.misses,
      attempts: circuits.reduce((sum, c) => sum + c.attempts, 0),
      retries: circuits.reduce((sum, c) => sum + c.retries, 0),
      blocked: circuits.reduce((sum, c) => sum + c.blocked, 0),
    };
    this.engine.state.peakQueue = 0;
    this.phase = "measure";
  }
  fault(recover = false) {
    const spec = this.spec;
    let config = structuredClone(this.engine.config);
    const value = recover;
    if (spec.fault === "database-outage")
      config.online = recover ? this.original.online : false;
    if (spec.fault === "cache-outage")
      config.cache.online = recover ? this.original.cache.online : false;
    if (spec.fault === "backend-outage") {
      const id = this.firstBackend;
      config.backendOverrides = {
        ...config.backendOverrides,
        [id]: {
          ...config.backendOverrides?.[id],
          online: recover ? backendSettings(this.original, id).online : value,
        },
      };
    }
    if (spec.fault === "cache-flush") {
      this.engine.state.entries = [];
    } else this.engine.configure(config);
    this.timeline.push({
      second: (this.engine.state.now - this.start) / 1000,
      text: recover
        ? "Restore original availability"
        : spec.fault.replaceAll("-", " "),
    });
  }
  tick() {
    if (this.finished) return;
    if (this.phase === "warmup") {
      if (this.warmIndex < this.warmIds.length) {
        this.engine.send(this.path(this.warmIndex++));
        let guard = 0;
        while (this.engine.running.length || this.engine.jobs.length) {
          if (++guard > 1000)
            throw new Error("Warm-up exceeded its event limit.");
          this.engine.step();
        }
        return;
      }
      this.begin();
      return;
    }
    const duration = this.spec.seconds * 1000;
    if (this.phase === "measure") {
      const arrival = (this.arrival * 1000) / this.spec.rate;
      const next = Math.min(
        arrival < duration ? arrival : Infinity,
        this.nextSample,
        duration,
        !this.failedAt && this.spec.fault !== "none"
          ? this.spec.faultAt * 1000
          : Infinity,
        !this.recovered &&
          this.spec.fault !== "none" &&
          this.spec.fault !== "cache-flush"
          ? this.spec.recoverAt * 1000
          : Infinity,
      );
      this.engine.advance(
        Math.max(0, this.start + next - this.engine.state.now),
      );
      if (
        !this.failedAt &&
        this.spec.fault !== "none" &&
        next >= this.spec.faultAt * 1000
      ) {
        this.failedAt = true;
        this.fault();
      }
      if (
        !this.recovered &&
        this.spec.fault !== "none" &&
        this.spec.fault !== "cache-flush" &&
        next >= this.spec.recoverAt * 1000
      ) {
        this.recovered = true;
        this.fault(true);
      }
      if (next === this.nextSample) {
        this.sample(next / 1000);
        this.nextSample += 1000;
      }
      if (next >= duration) {
        this.phase = "drain";
        this.drainStart = this.engine.state.now;
        return;
      }
      if (next >= arrival) {
        this.engine.send(this.path(this.arrival));
        this.arrival++;
        this.offered++;
      }
      return;
    }
    if (
      (!this.engine.running.length && !this.engine.jobs.length) ||
      this.engine.state.now - this.drainStart >= 60000
    ) {
      this.finish();
      return;
    }
    this.engine.advance(
      Math.min(1000, 60000 - (this.engine.state.now - this.drainStart)),
    );
  }
  sample(second: number) {
    const state = this.engine.state;
    this.series.push({
      second,
      sent: this.offered,
      success: this.results.filter((r) => r.status < 400).length,
      failed: this.results.filter((r) => r.status >= 400).length,
      queued: state.queue,
      active: state.activeCount,
      cacheHits: state.hits - this.initial.hits,
      reads: state.reads - this.initial.reads,
    });
  }
  finish() {
    const state = this.engine.state,
      successful = this.results.filter((r) => r.status < 400),
      durations = successful.map((r) => r.duration),
      failed = this.results.length - successful.length,
      pending = this.offered - this.results.length,
      statuses: Record<string, number> = {};
    for (const result of this.results)
      statuses[result.status] = (statuses[result.status] ?? 0) + 1;
    const p95 = percentile(durations, 0.95),
      successPercent = this.offered
        ? (successful.length / this.offered) * 100
        : 0;
    const examples = [
      ...this.results.filter((r) => r.status >= 400).slice(0, 2),
      ...successful
        .sort((a, b) => b.duration - a.duration || a.id - b.id)
        .slice(0, 2),
    ].map((r) => ({
      id: r.id,
      status: r.status,
      duration: r.duration,
      trace: r.trace,
    }));
    const circuits = Object.values(state.circuits);
    this.report = {
      spec: this.spec,
      fingerprint: configFingerprint(this.original),
      offered: this.offered,
      completed: this.results.length,
      success: successful.length,
      failed,
      pending,
      successPercent,
      p50: percentile(durations, 0.5),
      p95,
      p99: percentile(durations, 0.99),
      averageWait: this.results.length
        ? this.results.reduce((sum, r) => sum + r.wait, 0) / this.results.length
        : 0,
      reads: state.reads - this.initial.reads,
      hits: state.hits - this.initial.hits,
      misses: state.misses - this.initial.misses,
      peakQueue: state.peakQueue,
      attempts:
        circuits.reduce((sum, c) => sum + c.attempts, 0) -
        this.initial.attempts,
      retries:
        circuits.reduce((sum, c) => sum + c.retries, 0) - this.initial.retries,
      blocked:
        circuits.reduce((sum, c) => sum + c.blocked, 0) - this.initial.blocked,
      drainMs: state.now - this.drainStart,
      statuses,
      series: this.series,
      examples,
      timeline: this.timeline,
      passed:
        pending === 0 &&
        successPercent >= this.spec.targetSuccess &&
        successful.length > 0 &&
        p95 <= this.spec.targetP95,
    };
    this.finished = true;
    this.phase = "done";
  }
  progress() {
    if (this.finished) return 100;
    return this.phase === "warmup"
      ? 0
      : this.phase === "drain"
        ? 95
        : this.finished
          ? 100
          : Math.min(
              94,
              ((this.engine.state.now - this.start) /
                (this.spec.seconds * 1000)) *
                94,
            );
  }
}
