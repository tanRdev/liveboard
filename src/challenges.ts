import {
  parseBoard,
  serializeBoard,
  executionConfig,
  type Board,
} from "./board";
import {
  backendSettings,
  components,
  connectionSettings,
  type Config,
} from "./engine";
import {
  ExperimentRunner,
  experimentDefaults,
  parseExperiment,
  configFingerprint,
  type ExperimentSpec,
  type ExperimentReport,
} from "./experiments";
export const protectedFields = [
  "records",
  "delay",
  "online",
  "database",
  "routes",
  "processing",
  "connections",
  "network",
  "cacheTechnology",
  "gateway",
] as const;
export type ProtectedField = (typeof protectedFields)[number];
export const protectionLabels: Record<ProtectedField, string> = {
  records: "Seed records",
  delay: "Database processing delay",
  online: "Database availability",
  database: "Database technology and read settings",
  routes: "Backend routes",
  processing: "Per-service processing delay",
  connections: "Connections and routing topology",
  network: "Database connection conditions",
  cacheTechnology: "Cache technology",
  gateway: "Gateway traffic contract",
};
export type ChallengeRules = {
  maxBackends: number;
  maxSlots: number;
  maxQueue: number;
  maxTimeout: number;
  maxCacheBytes: number;
  minHealthy: number;
  preserveComponents: boolean;
  locked: ProtectedField[];
};
export const ruleDefaults: ChallengeRules = {
  maxBackends: 8,
  maxSlots: 16,
  maxQueue: 50,
  maxTimeout: 4000,
  maxCacheBytes: 1000000,
  minHealthy: 1,
  preserveComponents: true,
  locked: ["records", "delay", "online", "database", "routes", "processing"],
};
export type ChallengeTest = {
  id: string;
  label: string;
  spec: ExperimentSpec;
  maxReads?: number;
  maxAttempts?: number;
  minBlocked?: number;
  maxRetries?: number;
};
export type ChallengeDefinition = {
  format: "liveboard-challenge-v1";
  id: string;
  title: string;
  author: string;
  difficulty: "Starter" | "Intermediate" | "Advanced";
  problem: string;
  hints: string[];
  starter: Board;
  rules: ChallengeRules;
  tests: ChallengeTest[];
};
export type Check = {
  id: string;
  label: string;
  passed: boolean;
  actual: string;
  expected: string;
};
export type ChallengeReport = {
  definitionHash: string;
  fingerprint: string;
  passed: boolean;
  score: number;
  constraints: Check[];
  tests: {
    id: string;
    label: string;
    passed: boolean;
    checks: Check[];
    report: ExperimentReport;
  }[];
};
function canonical(value: unknown): string {
  return JSON.stringify(value, (_, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item).sort(([a], [b]) => a.localeCompare(b)),
        )
      : item,
  );
}
export function sameChallenge(
  a: ChallengeDefinition,
  b: ChallengeDefinition,
): boolean {
  return canonical(a) === canonical(b);
}
export function definitionHash(definition: ChallengeDefinition) {
  let hash = 2166136261;
  for (const char of canonical(definition))
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(16).padStart(8, "0");
}
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function text(value: unknown, label: string, max: number) {
  if (typeof value !== "string" || value.length > max)
    throw new Error(`Invalid challenge ${label}.`);
  return value;
}
function number(value: unknown, label: string, min: number, max: number) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  )
    throw new Error(`Invalid challenge ${label}.`);
  return value;
}
export function parseChallenge(input: string | unknown): ChallengeDefinition {
  if (typeof input === "string" && input.length > 2000000)
    throw new Error("Challenge files must be smaller than 2 MB.");
  const raw = typeof input === "string" ? JSON.parse(input) : input;
  if (!object(raw) || raw.format !== "liveboard-challenge-v1")
    throw new Error("Choose a Liveboard challenge file.");
  const id = text(raw.id, "ID", 80);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id))
    throw new Error(
      "Challenge IDs use lowercase letters, numbers, and hyphens.",
    );
  const title = text(raw.title, "title", 100);
  if (!title.trim()) throw new Error("Give the challenge a title.");
  const problem = text(raw.problem, "problem statement", 12000);
  if (!problem.trim()) throw new Error("Describe the incident.");
  if (
    typeof raw.difficulty !== "string" ||
    !["Starter", "Intermediate", "Advanced"].includes(raw.difficulty)
  )
    throw new Error("Choose a challenge difficulty.");
  if (!Array.isArray(raw.hints) || raw.hints.length > 5)
    throw new Error("Challenges support up to five hints.");
  const hints = raw.hints.map((h) => text(h, "hint", 2000));
  const starter = parseBoard(JSON.stringify(raw.starter));
  if (
    !starter.nodes.some((n) => n.data.role === "client") ||
    !starter.nodes.some((n) => n.data.role === "backend")
  )
    throw new Error(
      "Traffic challenges need a client and backend in the starter board.",
    );
  if (!object(raw.rules)) throw new Error("Define challenge resource limits.");
  const r = raw.rules;
  const rules: ChallengeRules = {
    maxBackends: number(r.maxBackends, "maximum services", 1, 8),
    maxSlots: number(r.maxSlots, "execution slots", 1, 128),
    maxQueue: number(r.maxQueue, "queue limit", 0, 500),
    maxTimeout: number(r.maxTimeout, "timeout limit", 1, 60000),
    maxCacheBytes: number(r.maxCacheBytes, "cache byte limit", 64, 1000000),
    minHealthy: number(r.minHealthy, "healthy services", 1, 8),
    preserveComponents: r.preserveComponents === true,
    locked: [],
  };
  if (
    typeof r.preserveComponents !== "boolean" ||
    !Array.isArray(r.locked) ||
    r.locked.length > protectedFields.length ||
    r.locked.some((v) => !protectedFields.includes(v as ProtectedField))
  )
    throw new Error("Invalid protected challenge settings.");
  rules.locked = [...new Set(r.locked)] as ProtectedField[];
  if (rules.minHealthy > rules.maxBackends)
    throw new Error("Healthy service requirement exceeds the service limit.");
  if (!Array.isArray(raw.tests) || raw.tests.length < 1 || raw.tests.length > 5)
    throw new Error("Define one to five traffic tests.");
  const seen = new Set<string>();
  const tests = raw.tests.map((value: unknown): ChallengeTest => {
    if (!object(value)) throw new Error("Invalid traffic test.");
    const id = text(value.id, "test ID", 80);
    if (!/^[a-z0-9-]+$/.test(id) || seen.has(id))
      throw new Error("Give each traffic test a unique ID.");
    seen.add(id);
    const label = text(value.label, "test label", 120);
    if (!label.trim()) throw new Error("Give each traffic test a label.");
    const spec = parseExperiment(value.spec);
    const test: ChallengeTest = { id, label, spec };
    for (const key of [
      "maxReads",
      "maxAttempts",
      "minBlocked",
      "maxRetries",
    ] as const)
      if (value[key] !== undefined)
        test[key] = number(value[key], key, 0, 100000);
    if (
      (spec.fault === "cache-outage" || spec.fault === "cache-flush") &&
      !starter.nodes.some((n) => n.data.role === "cache")
    )
      throw new Error(
        "A cache failure test needs a cache in the starter board.",
      );
    if (
      spec.fault === "database-outage" &&
      !starter.nodes.some((n) => n.data.role === "database")
    )
      throw new Error(
        "A database failure test needs a database in the starter board.",
      );
    return test;
  });
  return {
    format: "liveboard-challenge-v1",
    id,
    title,
    author: text(raw.author ?? "", "author", 100),
    difficulty: raw.difficulty as ChallengeDefinition["difficulty"],
    problem,
    hints,
    starter,
    rules,
    tests,
  };
}
function protectedValue(
  field: ProtectedField,
  config: Config,
  starter: Board,
): unknown {
  const ids = starter.nodes
    .filter((n) => n.data.role === "backend")
    .map((n) => n.id)
    .sort();
  if (field === "routes")
    return ids.map((id) => [id, backendSettings(config, id).route]);
  if (field === "processing")
    return ids.map((id) => [id, backendSettings(config, id).processingDelay]);
  if (field === "connections") return [...config.links].sort();
  if (field === "network")
    return ids.map((id) => [id, connectionSettings(config, `${id}-database`)]);
  if (field === "cacheTechnology") return config.cache.technology;
  return config[field];
}
export function checkConstraints(
  definition: ChallengeDefinition,
  board: Board,
): Check[] {
  const config = executionConfig(board),
    initial = executionConfig(definition.starter),
    rules = definition.rules,
    backends = components(config).filter((c) => c.role === "backend"),
    slots = backends.reduce(
      (sum, b) => sum + backendSettings(config, b.id).concurrency,
      0,
    ),
    queue = Math.max(
      0,
      ...backends.map((b) => backendSettings(config, b.id).queueLimit),
    ),
    timeout = Math.max(
      0,
      ...backends.map((b) => backendSettings(config, b.id).timeout),
    );
  const via =
    config.components?.some((c) => c.role === "balancer") &&
    config.links.includes("client-balancer");
  const healthy = backends.filter(
    (b) =>
      backendSettings(config, b.id).online &&
      config.links.includes(`${via ? "balancer" : "client"}-${b.id}`) &&
      (!via || config.balancer.online),
  ).length;
  const memory = components(config).some((c) => c.role === "cache")
    ? config.cache.maxmemory
    : 0;
  const checks: Check[] = [
    {
      id: "services",
      label: "Backend instances",
      passed: backends.length <= rules.maxBackends,
      actual: String(backends.length),
      expected: `≤ ${rules.maxBackends}`,
    },
    {
      id: "slots",
      label: "Total execution slots",
      passed: slots <= rules.maxSlots,
      actual: String(slots),
      expected: `≤ ${rules.maxSlots}`,
    },
    {
      id: "queue",
      label: "Queue limit per backend",
      passed: queue <= rules.maxQueue,
      actual: String(queue),
      expected: `≤ ${rules.maxQueue}`,
    },
    {
      id: "timeout",
      label: "Backend timeout · ms",
      passed: timeout <= rules.maxTimeout,
      actual: String(timeout),
      expected: `≤ ${rules.maxTimeout}`,
    },
    {
      id: "memory",
      label: "Configured cache bytes",
      passed: memory <= rules.maxCacheBytes,
      actual: String(memory),
      expected: `≤ ${rules.maxCacheBytes}`,
    },
    {
      id: "healthy",
      label: "Healthy routed backends",
      passed: healthy >= rules.minHealthy,
      actual: String(healthy),
      expected: `≥ ${rules.minHealthy}`,
    },
  ];
  if (rules.preserveComponents) {
    const retained = definition.starter.nodes.every((n) =>
      board.nodes.some((b) => b.id === n.id && b.data.role === n.data.role),
    );
    checks.push({
      id: "components",
      label: "Required components",
      passed: retained,
      actual: retained ? "Retained" : "Missing or replaced",
      expected: "Keep starter component identities and roles",
    });
  }
  for (const field of rules.locked) {
    const same =
      canonical(protectedValue(field, config, definition.starter)) ===
      canonical(protectedValue(field, initial, definition.starter));
    checks.push({
      id: `locked-${field}`,
      label: protectionLabels[field],
      passed: same,
      actual: same ? "Unchanged" : "Changed",
      expected: "Protected environment setting",
    });
  }
  return checks;
}
export function checkTest(
  test: ChallengeTest,
  report: ExperimentReport,
): Check[] {
  const checks: Check[] = [
    {
      id: "success",
      label: "Success of offered load",
      passed: report.successPercent >= test.spec.targetSuccess,
      actual: `${report.successPercent.toFixed(2)}%`,
      expected: `≥ ${test.spec.targetSuccess}%`,
    },
    {
      id: "p95",
      label: "Successful response P95",
      passed: report.success > 0 && report.p95 <= test.spec.targetP95,
      actual:
        report.success > 0
          ? `${Math.round(report.p95)} ms`
          : "No successful responses",
      expected: `≤ ${test.spec.targetP95} ms`,
    },
    {
      id: "pending",
      label: "Pending after drain",
      passed: report.pending === 0,
      actual: String(report.pending),
      expected: "0",
    },
  ];
  for (const [key, metric, label, min] of [
    ["maxReads", "reads", "Database reads", false],
    ["maxAttempts", "attempts", "Database attempts", false],
    ["minBlocked", "blocked", "Circuit rejections", true],
    ["maxRetries", "retries", "Retries", false],
  ] as const) {
    const limit = test[key];
    if (limit !== undefined)
      checks.push({
        id: key,
        label,
        passed: min ? report[metric] >= limit : report[metric] <= limit,
        actual: String(report[metric]),
        expected: `${min ? "≥" : "≤"} ${limit}`,
      });
  }
  return checks;
}
export class ChallengeRunner {
  definition: ChallengeDefinition;
  board: Board;
  constraints: Check[];
  runner?: ExperimentRunner;
  finished = false;
  report?: ChallengeReport;
  index = 0;
  results: ChallengeReport["tests"] = [];
  constructor(definition: ChallengeDefinition, board: Board) {
    this.definition = parseChallenge(definition);
    this.board = parseBoard(serializeBoard(board));
    this.constraints = checkConstraints(this.definition, this.board);
    if (this.constraints.some((c) => !c.passed)) this.finish();
    else
      this.runner = new ExperimentRunner(
        executionConfig(this.board),
        this.definition.tests[0].spec,
      );
  }
  tick() {
    if (this.finished) return;
    this.runner!.tick();
    if (!this.runner!.finished) return;
    const test = this.definition.tests[this.index],
      report = this.runner!.report!,
      checks = checkTest(test, report);
    this.results.push({
      id: test.id,
      label: test.label,
      passed: checks.every((c) => c.passed),
      checks,
      report,
    });
    this.index++;
    if (this.index === this.definition.tests.length) {
      this.finish();
      return;
    }
    this.runner = new ExperimentRunner(
      executionConfig(this.board),
      this.definition.tests[this.index].spec,
    );
  }
  finish() {
    const valid = this.constraints.every((c) => c.passed),
      passed =
        valid &&
        this.results.length === this.definition.tests.length &&
        this.results.every((r) => r.passed);
    this.report = {
      definitionHash: definitionHash(this.definition),
      fingerprint: configFingerprint(executionConfig(this.board)),
      passed,
      score: valid
        ? Math.round(
            (this.results.filter((r) => r.passed).length /
              this.definition.tests.length) *
              100,
          )
        : 0,
      constraints: this.constraints,
      tests: this.results,
    };
    this.finished = true;
  }
  progress() {
    return this.finished
      ? 100
      : ((this.index + (this.runner?.progress() ?? 0) / 100) /
          this.definition.tests.length) *
          100;
  }
}
export function createChallenge(board: Board): ChallengeDefinition {
  const starter = parseBoard(serializeBoard(board));
  return parseChallenge({
    format: "liveboard-challenge-v1",
    id: `custom-${crypto.randomUUID()}`,
    title: "Custom overload incident",
    author: "",
    difficulty: "Intermediate",
    problem:
      "The system becomes overloaded during peak traffic. Diagnose the bottleneck and meet the traffic objectives within the resource limits.",
    hints: [
      "Measure the current system before changing it.",
      "Inspect waiting requests and dependency latency.",
    ],
    starter,
    rules: { ...ruleDefaults },
    tests: [
      {
        id: "peak",
        label: "Peak traffic",
        spec: {
          ...experimentDefaults,
          name: "Peak traffic",
          rate: 10,
          seconds: 15,
          targetP95: 2000,
        },
      },
    ],
  });
}
export function parseSubmission(text: string): {
  challenge: ChallengeDefinition;
  solution: Board;
} {
  if (text.length > 3000000)
    throw new Error("Submission files must be smaller than 3 MB.");
  const raw: unknown = JSON.parse(text);
  if (!object(raw) || raw.format !== "liveboard-submission-v1")
    throw new Error("Choose a Liveboard submission file.");
  return {
    challenge: parseChallenge(raw.challenge),
    solution: parseBoard(JSON.stringify(raw.solution)),
  };
}
