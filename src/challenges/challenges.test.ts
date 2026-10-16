import { describe, expect, it } from "vitest";
import { challengeCatalog } from "./challengeCatalog";
import {
  ChallengeRunner,
  checkConstraints,
  parseChallenge,
  parseSubmission,
  definitionHash,
  sameChallenge,
  checkTest,
} from "./challenges";
import {
  scenario,
  parseBoard,
  serializeBoard,
  createNode,
  createEdge,
  executionConfig,
} from "../board/board";
import { Engine } from "../simulation/engine";
function evaluate(
  definition = challengeCatalog[0],
  board = structuredClone(definition.starter),
) {
  const runner = new ChallengeRunner(definition, board);
  for (let i = 0; !runner.finished && i < 100000; i++) runner.tick();
  expect(runner.finished).toBe(true);
  return runner.report!;
}
function solution(index: number) {
  const board = structuredClone(challengeCatalog[index].starter);
  switch (index) {
    case 0:
      board.config.concurrency = 4;
      board.config.backendOverrides!["backend-2"].concurrency = 4;
      break;
    case 1:
      board.config.resilienceOverrides.backend = {
        ...board.config.resilienceOverrides.backend,
        attemptTimeout: 1000,
      };
      break;
    case 2:
      board.config.cache.maxmemory = 2048;
      board.config.ttl = 60;
      board.config.concurrency = 8;
      break;
    case 3:
      board.config.resilienceOverrides.backend = {
        breaker: true,
        failureThreshold: 2,
        resetMs: 500,
        maxRetries: 0,
      };
      break;
    case 5:
      board.config.concurrency = 6;
      board.config.backendOverrides!["backend-3"].concurrency = 4;
      break;
    case 4:
      board.config.balancer.policy = "least-connections";
      board.config.concurrency = 2;
      board.config.backendOverrides!["backend-2"].concurrency = 2;
      break;
  }
  return board;
}
describe("Incident challenges", () => {
  for (let index = 0; index < challengeCatalog.length; index++) {
    const definition = challengeCatalog[index];
    it(`${definition.id}: starter fails and a bounded reference fix passes`, () => {
      const before = evaluate(definition);
      expect(before.constraints.filter((c) => !c.passed)).toEqual([]);
      expect(before.passed).toBe(false);
      const after = evaluate(definition, solution(index));
      expect(after.constraints.filter((c) => !c.passed)).toEqual([]);
      expect(
        after.tests.map((t) => ({
          id: t.id,
          failed: t.checks.filter((c) => !c.passed),
        })),
      ).toEqual(definition.tests.map((t) => ({ id: t.id, failed: [] })));
      expect(after.passed).toBe(true);
      expect(after.score).toBe(100);
    });
  }
  it("rejects resource violations before executing workloads", () => {
    const board = solution(0);
    board.config.concurrency = 8;
    const report = evaluate(challengeCatalog[0], board);
    expect(report.passed).toBe(false);
    expect(report.score).toBe(0);
    expect(report.tests).toEqual([]);
    expect(report.constraints.find((c) => c.id === "slots")?.passed).toBe(
      false,
    );
  });
  it("protects records, processing time, topology, and connection conditions", () => {
    const definition = challengeCatalog[1],
      board = solution(1);
    board.config.records = {};
    board.config.delay = 1;
    board.config.connectionOverrides["backend-database"].latency = 0;
    board.edges = [];
    const failed = checkConstraints(definition, board)
      .filter((c) => !c.passed)
      .map((c) => c.id);
    expect(failed).toEqual(
      expect.arrayContaining([
        "locked-records",
        "locked-delay",
        "locked-connections",
        "locked-network",
        "healthy",
      ]),
    );
  });
  it("compares protected data independently of object and edge order", () => {
    const definition = challengeCatalog[0],
      board = solution(0);
    board.edges.reverse();
    board.config.records = Object.fromEntries(
      Object.entries(board.config.records).reverse(),
    );
    expect(checkConstraints(definition, board).every((c) => c.passed)).toBe(
      true,
    );
    expect(definitionHash(definition)).toBe(
      definitionHash(structuredClone(definition)),
    );
  });
  it("captures immutable input and replays deterministic results", () => {
    const definition = structuredClone(challengeCatalog[0]),
      board = solution(0),
      runner = new ChallengeRunner(definition, board);
    definition.tests[0].spec.targetSuccess = 0;
    board.config.concurrency = 1;
    while (!runner.finished) runner.tick();
    expect(runner.report).toEqual(evaluate(challengeCatalog[0], solution(0)));
  });
  it("compares the complete original definition during submission review", () => {
    const original = challengeCatalog[0],
      changed = structuredClone(original);
    expect(
      sameChallenge(original, parseChallenge(JSON.stringify(original))),
    ).toBe(true);
    changed.tests[0].spec.targetP95++;
    expect(sameChallenge(original, changed)).toBe(false);
  });
  it("does not pass latency objectives without a successful response", () => {
    const report = evaluate().tests[0].report;
    const checks = checkTest(challengeCatalog[0].tests[0], {
      ...report,
      success: 0,
      successPercent: 0,
      p95: 0,
    });
    expect(checks.find((check) => check.id === "p95")?.passed).toBe(false);
  });
  it("parses submissions without accepting claimed assessment results", () => {
    const raw = {
      format: "liveboard-submission-v1",
      challenge: challengeCatalog[0],
      solution: challengeCatalog[0].starter,
      assessment: { passed: true, score: 100 },
    };
    const parsed = parseSubmission(JSON.stringify(raw));
    expect(parsed).not.toHaveProperty("assessment");
    expect(evaluate(parsed.challenge, parsed.solution).passed).toBe(false);
  });
  it.each([
    (d: any) => (d.tests = []),
    (d: any) => (d.difficulty = ["Starter"]),
    (d: any) => d.tests.push(d.tests[0]),
    (d: any) => (d.rules.maxBackends = 9),
    (d: any) => (d.rules.minHealthy = 9),
    (d: any) => (d.rules.locked = ["unknown"]),
    (d: any) => (d.rules.preserveComponents = "yes"),
    (d: any) => (d.hints = Array(6).fill("hint")),
    (d: any) => (d.tests[0].spec.rate = 101),
    (d: any) => (d.tests[0].maxReads = -1),
  ])("rejects invalid employer definitions", (mutate) => {
    const definition = structuredClone(challengeCatalog[0]);
    mutate(definition);
    expect(() => parseChallenge(definition)).toThrow();
  });
  it("supports eight service instances through import and execution", () => {
    const board = scenario("balanced");
    for (let n = 3; n <= 8; n++) {
      const id = `backend-${n}`;
      board.nodes.push(createNode("backend", id));
      board.edges.push(createEdge("balancer", id), createEdge(id, "database"));
      board.config.backendOverrides![id] = { concurrency: 1 };
    }
    const parsed = parseBoard(serializeBoard(board));
    const engine = new Engine();
    engine.configure(executionConfig(parsed));
    engine.send("/users/1", 8);
    engine.advance(20000);
    expect(new Set(engine.state.results.map((r) => r.backendId)).size).toBe(8);
    expect(engine.state.results.every((r) => r.status === 200)).toBe(true);
  });
});
