import { describe, expect, it } from "vitest";
import { Engine, defaults, type Config, type Role } from "./engine";
import { createEdge, createNode, executionConfig, scenario } from "../board/board";
function scaled(): Config {
  const board = scenario("balanced");
  return {
    ...board.config,
    components: board.nodes.map((n) => ({
      id: n.id,
      role: n.data.role as Role,
      name: String(n.data.name),
    })),
    links: board.edges.map((e) => e.id),
  };
}
function configured(config: Config = scaled()) {
  const e = new Engine();
  e.configure(config);
  return e;
}
describe("load balancing", () => {
  it("routes round robin and records the selected instance and real connection IDs", () => {
    const e = configured();
    e.send("/users/1", 6);
    expect(e.state.backends.backend.assigned).toBe(3);
    expect(e.state.backends["backend-2"].assigned).toBe(3);
    e.advance(10000);
    expect(e.state.results.every((r) => r.status === 200)).toBe(true);
    expect(new Set(e.state.results.map((r) => r.backendId))).toEqual(
      new Set(["backend", "backend-2"]),
    );
    expect(
      e.state.events.some(
        (event) =>
          event.edge === "backend-2-cache" && event.text.startsWith("Lookup"),
      ),
    ).toBe(true);
    expect(
      e.state.events.some(
        (event) => event.edge === "balancer-backend-2" && event.reverse,
      ),
    ).toBe(true);
    expect(
      e.state.events.some(
        (event) => event.edge === "client-balancer" && event.reverse,
      ),
    ).toBe(true);
  });
  it("uses one shared cache across instances", () => {
    const e = configured();
    e.send("/users/1");
    e.advance(2500);
    e.send("/users/1");
    e.advance(2500);
    expect(e.state.results[0]).toMatchObject({
      backendId: "backend-2",
      source: "cache",
      status: 200,
    });
    expect(e.state.reads).toBe(1);
    expect(e.state.entries).toHaveLength(1);
  });
  it("sends more requests to a faster target with least connections", () => {
    function experiment(policy: Config["balancer"]["policy"]) {
      const e = configured({
        ...scaled(),
        ttl: 3600,
        balancer: { policy, online: true },
      });
      e.setTraffic(2, "/users/1", true);
      e.advance(20000);
      e.setTraffic(2, "/users/1", false);
      e.advance(20000);
      return e;
    }
    const rr = experiment("round-robin");
    const least = experiment("least-connections");
    expect(
      Math.abs(
        rr.state.backends.backend.assigned -
          rr.state.backends["backend-2"].assigned,
      ),
    ).toBeLessThanOrEqual(1);
    expect(least.state.backends.backend.assigned).toBeGreaterThan(
      least.state.backends["backend-2"].assigned,
    );
    expect(least.state.metrics.totalWait).toBeLessThan(
      rr.state.metrics.totalWait,
    );
  });
  it("enforces separate queues and concurrency for each instance", () => {
    const e = configured({ ...scaled(), queueLimit: 1, backendOverrides: {} });
    e.send("/users/1", 6);
    expect(e.state.activeCount).toBe(2);
    expect(e.state.queue).toBe(2);
    expect(e.state.metrics.rejected).toBe(2);
    for (const backend of Object.values(e.state.backends))
      expect(backend).toMatchObject({ active: 1, queued: 1, rejected: 1 });
    e.advance(6000);
    expect(e.state.metrics.completed).toBe(6);
    expect(e.state.results.filter((r) => r.status === 200)).toHaveLength(4);
  });
  it("bypasses unhealthy instances and fails work already assigned to a failed instance", () => {
    const base = scaled();
    const e = configured(base);
    e.send("/users/1", 4);
    e.advance(200);
    e.configure({
      ...base,
      backendOverrides: {
        ...base.backendOverrides,
        backend: { online: false },
      },
    });
    e.advance(3000);
    expect(
      e.state.results
        .filter((r) => r.backendId === "backend")
        .every((r) => r.status === 503),
    ).toBe(true);
    expect(
      e.state.results
        .filter((r) => r.backendId === "backend-2")
        .every((r) => r.status === 200),
    ).toBe(true);
    e.send("/users/1", 2);
    e.advance(4000);
    expect(
      e.state.results
        .slice(0, 2)
        .every((r) => r.backendId === "backend-2" && r.status === 200),
    ).toBe(true);
    expect(e.state.backends.backend.failed).toBe(2);
    e.configure(base);
    e.send("/users/1", 2);
    e.advance(4000);
    expect(
      new Set(e.state.results.slice(0, 2).map((r) => r.backendId)),
    ).toEqual(new Set(["backend", "backend-2"]));
  });
  it("shares direct client connections across healthy backends", () => {
    const board = scenario("empty");
    board.nodes = [
      createNode("client"),
      createNode("backend", "backend", { x: 300, y: 40 }),
      createNode("backend", "backend-2", { x: 300, y: 280 }),
      createNode("database"),
    ];
    board.edges = [
      createEdge("client", "backend"),
      createEdge("client", "backend-2"),
      createEdge("backend", "database"),
      createEdge("backend-2", "database"),
    ];
    const engine = new Engine();
    engine.configure({ ...defaults, ...executionConfig(board) });
    engine.send("/users/1", 6);
    expect(engine.state.backends.backend.reachable).toBe(true);
    expect(engine.state.backends["backend-2"].reachable).toBe(true);
    expect(engine.state.backends.backend.assigned).toBe(3);
    expect(engine.state.backends["backend-2"].assigned).toBe(3);
    engine.configure({
      ...engine.config,
      backendOverrides: { "backend-2": { online: false } },
    });
    engine.send("/users/1", 4);
    expect(engine.state.backends.backend.assigned).toBe(7);
    expect(engine.state.backends["backend-2"].assigned).toBe(3);
  });
  it("returns 503 when all targets or the balancer are offline", () => {
    const base = scaled();
    const e = configured({
      ...base,
      backendOverrides: {
        backend: { online: false },
        "backend-2": { online: false },
      },
    });
    e.send("/users/1");
    expect(e.state.results[0].status).toBe(503);
    e.configure({
      ...base,
      balancer: { policy: "round-robin", online: false },
    });
    e.send("/users/1");
    expect(e.state.results[0].body).toEqual({
      error: "Load balancer unavailable",
    });
  });
  it("uses only the assigned backend connections", () => {
    const base = scaled();
    const e = configured({
      ...base,
      links: base.links.filter((link) => link !== "backend-2-database"),
    });
    e.send("/users/2", 2);
    e.advance(4000);
    expect(
      e.state.results.find((r) => r.backendId === "backend-2")?.status,
    ).toBe(503);
    expect(e.state.results.find((r) => r.backendId === "backend")?.status).toBe(
      200,
    );
  });
  it("fails a response when the database or balancer disappears during execution", () => {
    const base = scaled();
    const e = configured(base);
    e.send("/users/1");
    while (e.state.reads === 0) e.step();
    e.configure({ ...base, online: false });
    e.advance(4000);
    expect(e.state.results[0].status).toBe(503);
    const other = configured(base);
    other.send("/users/1");
    other.step();
    other.configure({
      ...base,
      balancer: { policy: "round-robin", online: false },
    });
    other.advance(4000);
    expect(other.state.results[0].status).toBe(503);
  });
  it("does not strand requests when a backend is removed", () => {
    const base = scaled();
    const e = configured(base);
    e.send("/users/1", 6);
    e.advance(200);
    e.configure({
      ...base,
      components: base.components!.filter((node) => node.id !== "backend"),
    });
    e.advance(10000);
    expect(e.state.metrics.completed).toBe(6);
    expect(e.state.queue).toBe(0);
    expect(e.state.activeCount).toBe(0);
  });
  it("keeps multi-instance execution independent of playback tick size", () => {
    const a = configured();
    const b = configured();
    for (const e of [a, b]) e.setTraffic(7, "/users/1", true);
    a.advance(10000);
    for (let i = 0; i < 200; i++) b.advance(50);
    expect(a.state).toEqual(b.state);
  });
});

it("does not give a replacement backend requests assigned to a removed instance", () => {
  const base = scaled();
  const e = configured(base);
  e.send("/users/1", 4);
  e.advance(200);
  e.configure({
    ...base,
    components: base.components!.filter((node) => node.id !== "backend"),
  });
  e.configure(base);
  e.advance(6000);
  expect(
    e.state.results
      .filter((result) => result.backendId === "backend")
      .every((result) => result.status === 503),
  ).toBe(true);
  expect(e.state.metrics.completed).toBe(4);
});
