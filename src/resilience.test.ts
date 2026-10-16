import { describe, it, expect } from "vitest";
import { Engine, defaults, resilienceSettings } from "./engine";
import { scenario, executionConfig, serializeBoard, parseBoard } from "./board";
import { CircuitBank, resilienceDefaults, retryDelay } from "./resilience";
function setup() {
  const e = new Engine();
  e.configure(executionConfig(scenario("resilience")));
  return e;
}
function run(e: Engine, path = "/users/1") {
  e.send(path);
  e.advance(5000);
  return e.state.results[0];
}
describe("Dependency retries and connection failures", () => {
  it("retries a transient read failure and records backoff decisions", () => {
    const e = setup();
    e.configure({
      ...e.config,
      resilienceOverrides: { backend: { maxRetries: 1, backoffMs: 50 } },
      connectionOverrides: { "backend-database": { failureEvery: 2 } },
    });
    expect(run(e).status).toBe(200);
    const result = run(e);
    expect(result.status).toBe(200);
    expect(
      result.trace.some(
        (t) => t.text === "Retry in 50 ms · exponential backoff",
      ),
    ).toBe(true);
    expect(e.state.circuits.backend).toMatchObject({ attempts: 3, retries: 1 });
  });
  it("limits retries and keeps them inside the overall backend timeout", () => {
    const e = setup();
    e.configure({
      ...e.config,
      online: false,
      delay: 500,
      timeout: 1000,
      resilienceOverrides: {
        backend: { maxRetries: 3, backoffMs: 100, attemptTimeout: 800 },
      },
    });
    const result = run(e);
    expect(result.status).toBe(504);
    expect(result.duration).toBe(1000);
    expect(e.state.circuits.backend.attempts).toBeLessThanOrEqual(4);
  });
  it("enforces attempt deadlines during a slow database response", () => {
    const e = setup();
    e.configure({
      ...e.config,
      delay: 100,
      resilienceOverrides: { backend: { attemptTimeout: 150 } },
      connectionOverrides: {},
    });
    const result = run(e);
    expect(result).toMatchObject({ status: 504, source: "timeout" });
    expect(
      result.trace.some((t) => t.text.includes("Database call timed out")),
    ).toBe(true);
  });
  it("models connection latency in both directions", () => {
    const a = setup(),
      b = setup();
    a.configure({ ...a.config, connectionOverrides: {} });
    b.configure({
      ...b.config,
      connectionOverrides: { "backend-database": { latency: 50 } },
    });
    expect(run(b).duration - run(a).duration).toBe(100);
  });
  it("fails an in-flight database read when its connection closes", () => {
    const e = setup();
    e.configure({ ...e.config, connectionOverrides: {} });
    e.send("/users/1");
    while (!e.state.events.some((t) => t.text.startsWith("Read users")))
      e.step();
    e.configure({
      ...e.config,
      connectionOverrides: { "backend-database": { online: false } },
    });
    e.advance(2000);
    expect(e.state.results[0].status).toBe(503);
  });
  it("does not retry missing routes, records, or database throttling", () => {
    for (const path of ["/missing/1", "/users/999"]) {
      const e = setup();
      e.configure({
        ...e.config,
        connectionOverrides: {},
        resilienceOverrides: { backend: { maxRetries: 3 } },
      });
      expect(run(e, path).status).toBe(404);
      expect(e.state.circuits.backend?.retries ?? 0).toBe(0);
    }
    const e = setup();
    e.configure({
      ...e.config,
      connectionOverrides: {},
      resilienceOverrides: { backend: { maxRetries: 3 } },
      database: {
        ...defaults.database,
        technology: "dynamodb",
        readCapacity: 1,
      },
    });
    e.database.read("1", 0);
    e.send("/users/1");
    e.advance(900);
    expect(e.state.results[0].status).toBe(429);
    expect(e.state.circuits.backend.retries).toBe(0);
  });
  it("uses bounded fixed and exponential retry delays", () => {
    expect(retryDelay({ ...resilienceDefaults, backoffMs: 100 }, 1)).toBe(100);
    expect(retryDelay({ ...resilienceDefaults, backoffMs: 100 }, 3)).toBe(400);
    expect(
      retryDelay(
        { ...resilienceDefaults, backoffMs: 100, backoff: "fixed" },
        3,
      ),
    ).toBe(100);
    expect(retryDelay({ ...resilienceDefaults, backoffMs: 60000 }, 3)).toBe(
      60000,
    );
  });
});
describe("Circuit breaker generations", () => {
  const settings = {
    ...resilienceDefaults,
    breaker: true,
    failureThreshold: 2,
    resetMs: 1000,
  };
  it("opens, rejects calls, permits one probe, and closes after recovery", () => {
    const b = new CircuitBank();
    let p = b.before("a", settings, 0);
    b.failure("a", settings, 10, p.generation);
    p = b.before("a", settings, 10);
    b.failure("a", settings, 20, p.generation);
    expect(b.before("a", settings, 500).allowed).toBe(false);
    p = b.before("a", settings, 1020);
    expect(p.allowed).toBe(true);
    expect(b.get("a").state).toBe("half-open");
    expect(b.before("a", settings, 1020).allowed).toBe(false);
    b.success("a", p.generation);
    expect(b.get("a").state).toBe("closed");
  });
  it("does not let a late success close a newer open circuit", () => {
    const b = new CircuitBank();
    const a = b.before("a", settings, 0),
      old = b.before("a", settings, 0);
    b.failure("a", { ...settings, failureThreshold: 1 }, 1, a.generation);
    b.success("a", old.generation);
    expect(b.get("a").state).toBe("open");
  });
  it("does not let stale completions corrupt a recovered circuit", () => {
    const b = new CircuitBank();
    const a = b.before("a", settings, 0);
    b.failure("a", { ...settings, failureThreshold: 1 }, 1, a.generation);
    const probe = b.before("a", settings, 1001);
    b.success("a", probe.generation);
    b.failure("a", settings, 1002, a.generation);
    expect(b.get("a")).toMatchObject({ state: "closed", failures: 0 });
  });
  it("reopens after a failed probe and releases cancelled probes", () => {
    const b = new CircuitBank();
    let p = b.before("a", settings, 0);
    b.failure("a", { ...settings, failureThreshold: 1 }, 1, p.generation);
    p = b.before("a", settings, 1001);
    b.cancel("a", p.generation);
    expect(b.before("a", settings, 1001).allowed).toBe(true);
    b.failure("a", settings, 1002, p.generation);
    expect(b.get("a")).toMatchObject({ state: "open", openUntil: 2002 });
  });
  it("keeps cache hits available while a database circuit is open", () => {
    const e = new Engine();
    e.configure({
      ...defaults,
      resilienceOverrides: {
        backend: { breaker: true, failureThreshold: 1, resetMs: 30000 },
      },
    });
    expect(run(e).status).toBe(200);
    e.configure({ ...e.config, online: false });
    expect(run(e, "/users/2").status).toBe(503);
    expect(e.state.circuits.backend.state).toBe("open");
    expect(run(e).source).toBe("cache");
    expect(run(e, "/users/2").source).toBe("circuit");
  });
  it("resumes database calls after cooldown and handles backend replacement", () => {
    const e = setup();
    e.configure({
      ...e.config,
      online: false,
      resilienceOverrides: {
        backend: { breaker: true, failureThreshold: 1, resetMs: 1000 },
      },
    });
    expect(run(e).status).toBe(503);
    e.configure({ ...e.config, online: true, connectionOverrides: {} });
    expect(run(e).status).toBe(200);
    expect(e.state.circuits.backend.state).toBe("closed");
    e.configure({ ...e.config, roles: [], components: [], links: [] });
    expect(e.state.circuits.backend).toBeUndefined();
  });
});
describe("Resilience board settings", () => {
  it("round-trips policies and rejects invalid input", () => {
    const b = scenario("resilience");
    b.config.resilienceOverrides = {
      backend: { breaker: true, maxRetries: 2, attemptTimeout: 400 },
    };
    const restored = parseBoard(serializeBoard(b));
    expect(resilienceSettings(restored.config, "backend")).toMatchObject({
      breaker: true,
      maxRetries: 2,
      attemptTimeout: 400,
    });
    for (const patch of [
      { resilienceOverrides: { backend: { maxRetries: 99 } } },
      { resilienceOverrides: { "backend-9": { breaker: true } } },
      { connectionOverrides: { "client-backend": { latency: 3 } } },
      { connectionOverrides: { "backend-database": { latency: -1 } } },
    ])
      expect(() =>
        parseBoard(JSON.stringify({ ...b, config: { ...b.config, ...patch } })),
      ).toThrow();
  });
});
