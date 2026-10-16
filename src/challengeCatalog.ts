import { scenario, type Board } from "./board";
import {
  parseChallenge,
  ruleDefaults,
  type ChallengeDefinition,
  type ChallengeTest,
} from "./challenges";
import { experimentDefaults } from "./experiments";
import { defaultBrief } from "./interview";
function test(
  id: string,
  label: string,
  patch: Partial<ChallengeTest["spec"]>,
  limits: Partial<ChallengeTest> = {},
): ChallengeTest {
  return {
    id,
    label,
    spec: {
      ...experimentDefaults,
      name: label,
      targetSuccess: 99,
      targetP95: 2000,
      ...patch,
    },
    ...limits,
  };
}
function challenge(
  id: string,
  title: string,
  difficulty: ChallengeDefinition["difficulty"],
  problem: string,
  starter: Board,
  rules: Partial<ChallengeDefinition["rules"]>,
  tests: ChallengeTest[],
  hints: string[],
): ChallengeDefinition {
  starter.title = title;
  starter.interview = {
    ...structuredClone(defaultBrief),
    prompt: problem,
    requirements:
      "Meet every traffic objective while staying within the resource limits. Explain the bottleneck and the trade-off behind your fix.",
  };
  return parseChallenge({
    format: "liveboard-challenge-v1",
    id,
    title,
    author: "Liveboard",
    difficulty,
    problem,
    starter,
    rules: { ...ruleDefaults, ...rules },
    tests,
    hints,
  });
}
function catalog(): ChallengeDefinition[] {
  const launch = scenario("balanced");
  launch.config.backendOverrides = {
    "backend-2": { processingDelay: 0, timeout: 3000 },
  };
  launch.config.timeout = 3000;
  launch.config.queueLimit = 20;
  const latency = scenario("resilience");
  latency.config.connectionOverrides = {
    "backend-database": { latency: 350, failureEvery: 0 },
  };
  latency.config.timeout = 2500;
  const cache = scenario("redis");
  cache.config.cache.maxmemory = 128;
  cache.config.ttl = 1;
  cache.config.concurrency = 4;
  cache.config.delay = 400;
  cache.config.timeout = 3000;
  cache.config.records = Object.fromEntries(
    Array.from({ length: 10 }, (_, i) => {
      const id = String(i + 1);
      return [id, { id, name: `User ${id}`, email: `user${id}@example.com` }];
    }),
  );
  const outage = scenario("database");
  outage.config.database.readFrom = "primary";
  outage.config.delay = 120;
  outage.config.concurrency = 8;
  outage.config.timeout = 1500;
  const uneven = scenario("balanced");
  uneven.config.backendOverrides = {
    "backend-2": { processingDelay: 1000, timeout: 4000 },
  };
  uneven.config.timeout = 4000;
  uneven.config.queueLimit = 30;
  return [
    challenge(
      "launch-day",
      "Launch-day overload",
      "Starter",
      "A public launch drives traffic above the API’s current capacity. Requests wait, then fail. Meet both traffic profiles with at most eight execution slots.",
      launch,
      {
        maxBackends: 3,
        maxSlots: 8,
        maxQueue: 20,
        maxTimeout: 3000,
        minHealthy: 2,
      },
      [
        test("normal", "Normal traffic", { rate: 4, seconds: 8 }),
        test("peak", "Launch traffic", { rate: 12, seconds: 12 }),
      ],
      [
        "Compare arrival rate with the time each request occupies an execution slot.",
        "Waiting capacity buffers work. It does not increase processing capacity.",
        "Try four execution slots on each existing backend. Compare the same workload again.",
      ],
    ),
    challenge(
      "slow-link",
      "The slow dependency",
      "Intermediate",
      "The database is healthy, but a slow connection causes timeouts. The network latency is fixed. Recover successful reads without increasing the overall request budget beyond 2.5 seconds.",
      latency,
      {
        maxBackends: 1,
        maxSlots: 4,
        maxQueue: 20,
        maxTimeout: 2500,
        locked: [...ruleDefaults.locked, "network", "connections"],
      },
      [test("slow", "Slow network", { rate: 2, seconds: 8, targetP95: 1500 })],
      [
        "Inspect the attempt timeout and the time spent in both network directions.",
        "The dependency budget must cover processing plus the request and response journey.",
        "The call takes 820 ms. An attempt timeout of 1,000 ms fits within the backend budget.",
      ],
    ),
    challenge(
      "cache-pressure",
      "The cache that never helps",
      "Intermediate",
      "A read-heavy API has a cache, yet database reads remain high. Ten user keys rotate through the workload. Fix expiry and memory pressure within a 2,048-byte cache budget.",
      cache,
      {
        maxBackends: 1,
        maxSlots: 8,
        maxQueue: 50,
        maxTimeout: 3000,
        maxCacheBytes: 2048,
        locked: [...ruleDefaults.locked, "cacheTechnology", "connections"],
      },
      [
        test(
          "rotation",
          "Rotating profile reads",
          { rate: 12, seconds: 20, pattern: "round-robin", keys: 10 },
          { maxReads: 30 },
        ),
      ],
      [
        "Watch cache misses, evictions, and expiry while the IDs rotate.",
        "A cache must retain the working set long enough for repeated reads.",
        "Try 2,048 cache bytes, a 60-second expiry, and eight backend execution slots.",
      ],
    ),
    challenge(
      "dependency-outage",
      "Contain the outage",
      "Advanced",
      "The database fails from second 3 through second 8. Reject calls to the failing dependency, retain capacity, then recover. A circuit breaker must reduce downstream attempts.",
      outage,
      {
        maxBackends: 1,
        maxSlots: 8,
        maxQueue: 50,
        maxTimeout: 1500,
        locked: [...ruleDefaults.locked, "connections"],
      },
      [
        test(
          "outage",
          "Outage and recovery",
          {
            rate: 10,
            seconds: 12,
            fault: "database-outage",
            faultAt: 3,
            recoverAt: 8,
            targetSuccess: 50,
            targetP95: 1500,
          },
          { maxAttempts: 100, minBlocked: 20, maxRetries: 0 },
        ),
      ],
      [
        "Repeated calls to a failing dependency can consume the entire service budget.",
        "Open the circuit after repeated failures. Use a bounded recovery probe.",
        "Try a two-failure threshold and a 500 ms cooldown. Keep retries disabled.",
      ],
    ),
    challenge(
      "uneven-replicas",
      "One slow replica",
      "Advanced",
      "One backend needs an extra second of processing. Keep both backends healthy, preserve the wiring, and meet peak traffic with only four total execution slots.",
      uneven,
      {
        maxBackends: 2,
        maxSlots: 4,
        maxQueue: 30,
        maxTimeout: 4000,
        minHealthy: 2,
        locked: [...ruleDefaults.locked, "connections"],
      },
      [
        test("uneven", "Uneven service capacity", {
          rate: 4,
          seconds: 15,
          targetP95: 2500,
        }),
      ],
      [
        "Equal request counts can be unfair when service times differ.",
        "Compare per-instance waiting work and use capacity where it processes the most requests.",
        "Try least-connections routing, two execution slots per backend.",
      ],
    ),
  ];
}
export const challengeCatalog = catalog();
