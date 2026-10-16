import { describe, expect, it } from "vitest";
import { Engine, defaults, type Config } from "./engine";
import {
  parseBoard,
  serializeBoard,
  scenario,
  createNode,
  createEdge,
  canConnect,
} from "./board";
function serviceConfig(calls: "parallel" | "sequential" = "parallel"): Config {
  return {
    ...structuredClone(defaults),
    concurrency: 4,
    timeout: 5000,
    components: [
      { id: "client", role: "client", name: "Client" },
      { id: "backend", role: "backend", name: "Checkout" },
      { id: "backend-2", role: "backend", name: "Inventory" },
      { id: "backend-3", role: "backend", name: "Payments" },
      { id: "queue", role: "queue", name: "Fulfillment" },
      { id: "worker", role: "worker", name: "Warehouse" },
    ],
    links: [
      "client-backend",
      "backend-backend-2",
      "backend-backend-3",
      "backend-queue",
      "queue-worker",
    ],
    serviceOverrides: {
      backend: {
        mode: "handler",
        calls,
        publish: "queue",
        dependencyTimeout: 4000,
      },
      "backend-2": { mode: "handler" },
      "backend-3": { mode: "handler" },
    },
    backendOverrides: {
      "backend-2": { processingDelay: 200 },
      "backend-3": { processingDelay: 600 },
    },
  };
}
function run(config = serviceConfig(), count = 1) {
  const engine = new Engine();
  engine.configure(config);
  engine.send("/users/1", count);
  engine.advance(15000);
  return engine;
}
describe("service dependencies", () => {
  it("joins parallel calls, publishes fulfillment, and records one client result", () => {
    const e = run();
    expect(e.state.results).toHaveLength(1);
    expect(e.state.results[0]).toMatchObject({
      status: 200,
      source: "service",
      body: {
        service: "Checkout",
        dependencies: {
          "backend-2": { service: "Inventory" },
          "backend-3": { service: "Payments" },
        },
      },
    });
    expect(e.state.metrics).toMatchObject({ sent: 1, completed: 1, failed: 0 });
    expect(e.state.queueLab.published).toBe(1);
    expect(e.state.queueLab.processed).toBe(1);
    expect(
      e.state.events
        .filter((event) => event.edge === "backend-backend-2")
        .some((event) => event.reverse),
    ).toBe(true);
    expect(
      e.state.events
        .filter((event) => event.edge === "backend-backend-3")
        .every((event) => event.request === 1),
    ).toBe(true);
    expect(e.state.events.some((event) => event.edge === "backend-queue")).toBe(
      true,
    );
  });
  it("executes sequential calls in order, with greater latency than parallel calls", () => {
    const parallel = run(),
      sequential = run(serviceConfig("sequential"));
    expect(sequential.state.results[0].duration).toBeGreaterThan(
      parallel.state.results[0].duration,
    );
    const trace = sequential.state.results[0].trace;
    const firstReturn = trace.find(
      (event) => event.edge === "backend-backend-2" && event.reverse,
    )!;
    const nextCall = trace.find(
      (event) => event.edge === "backend-backend-3" && !event.reverse,
    )!;
    expect(nextCall.time).toBeGreaterThanOrEqual(firstReturn.time);
  });
  it("shares dependency capacity across requests and propagates overload", () => {
    const config = serviceConfig();
    config.backendOverrides!["backend-3"] = {
      concurrency: 1,
      queueLimit: 0,
      processingDelay: 600,
    };
    const e = run(config, 4);
    expect(
      e.state.results.filter((result) => result.status === 429),
    ).toHaveLength(3);
    expect(e.state.queueLab.published).toBe(1);
    expect(e.state.backends["backend-3"].rejected).toBe(3);
    expect(e.running).toHaveLength(0);
    expect(e.jobs).toHaveLength(0);
  });
  it("propagates unavailable dependencies and publishes no fulfillment event", () => {
    const config = serviceConfig();
    config.backendOverrides!["backend-3"] = { online: false };
    const e = run(config);
    expect(e.state.results[0]).toMatchObject({
      status: 503,
      body: { dependency: "backend-3" },
    });
    expect(e.state.queueLab.published).toBe(0);
    expect(
      Object.values(e.state.backends).every(
        (backend) => backend.active === 0 && backend.queued === 0,
      ),
    ).toBe(true);
  });
  it("cancels queued and running descendants when the caller times out", () => {
    const config = serviceConfig();
    config.serviceOverrides.backend.dependencyTimeout = 400;
    config.backendOverrides!["backend-3"] = {
      concurrency: 1,
      processingDelay: 4000,
    };
    const e = run(config, 4);
    expect(e.state.results.every((result) => result.status === 504)).toBe(true);
    expect(e.state.queueLab.published).toBe(0);
    expect(e.running).toHaveLength(0);
    expect(e.jobs).toHaveLength(0);
    expect(
      Object.values(e.state.backends).every(
        (backend) => backend.active === 0 && backend.queued === 0,
      ),
    ).toBe(true);
  });
  it("allows nested chains but rejects cycles without deadlocking", () => {
    const config = serviceConfig();
    config.links = [
      "client-backend",
      "backend-backend-2",
      "backend-2-backend-3",
    ];
    config.serviceOverrides.backend.publish = "none";
    expect(run(config).state.results[0].status).toBe(200);
    config.links.push("backend-3-backend");
    const e = run(config);
    expect(e.state.results[0].status).toBe(503);
    expect(e.state.events.some((event) => event.text.includes("cycle"))).toBe(
      true,
    );
    expect(e.running).toHaveLength(0);
  });
  it("fails the request if its fulfillment queue rejects publication", () => {
    const config = serviceConfig();
    config.queueSettings.online = false;
    const e = run(config);
    expect(e.state.results[0].status).toBe(503);
    expect(e.state.queueLab.published).toBe(0);
  });
  it("passes the identifier into each dependency route", () => {
    const config = serviceConfig();
    config.backendOverrides!["backend-2"] = { route: "/inventory/:id" };
    const e = run(config);
    expect(e.state.results[0].status).toBe(200);
    expect(
      e.state.events.some((event) => event.text.includes("GET /inventory/1")),
    ).toBe(true);
  });
  it("cancels the entire request tree when its entry service is removed", () => {
    const config = serviceConfig(),
      e = new Engine();
    e.configure(config);
    e.send("/users/1", 3);
    e.advance(500);
    expect(e.running.some((job) => job.backendId === "backend-3")).toBe(true);
    config.components = config.components!.filter(
      (component) => component.id !== "backend",
    );
    e.configure(config);
    e.advance(10000);
    expect(e.state.results).toHaveLength(3);
    expect(e.state.results.every((result) => result.status === 503)).toBe(true);
    expect(e.state.queueLab.published).toBe(0);
    expect(e.running).toHaveLength(0);
    expect(e.jobs).toHaveLength(0);
    expect(
      Object.values(e.state.backends).every(
        (backend) => backend.active === 0 && backend.queued === 0,
      ),
    ).toBe(true);
  });
  it("propagates removal of an active dependency without duplicate client results", () => {
    const config = serviceConfig(),
      e = new Engine();
    e.configure(config);
    e.send("/users/1");
    e.advance(500);
    config.components = config.components!.filter(
      (component) => component.id !== "backend-3",
    );
    e.configure(config);
    e.advance(10000);
    expect(e.state.results).toHaveLength(1);
    expect(e.state.results[0].status).toBe(503);
    expect(e.state.queueLab.published).toBe(0);
    expect(e.running).toHaveLength(0);
    expect(e.jobs).toHaveLength(0);
  });
  it("fails active calls if their service connection is removed", () => {
    const config = serviceConfig(),
      e = new Engine();
    e.configure(config);
    e.send("/users/1");
    e.advance(500);
    config.links = config.links.filter((link) => link !== "backend-backend-3");
    e.configure(config);
    e.advance(10000);
    expect(e.state.results[0].status).toBe(503);
    expect(e.state.queueLab.published).toBe(0);
    expect(e.running).toHaveLength(0);
  });
  it("bounds a child queue wait by its caller's dependency deadline", () => {
    const config = serviceConfig();
    config.serviceOverrides.backend.dependencyTimeout = 1000;
    config.backendOverrides!["backend-3"] = {
      concurrency: 1,
      queueLimit: 10,
      processingDelay: 400,
    };
    const e = run(config, 3);
    expect(e.state.results.every((result) => result.duration <= 1280)).toBe(
      true,
    );
    expect(
      e.state.results.filter((result) => result.status === 504),
    ).toHaveLength(2);
    expect(e.state.queueLab.published).toBe(1);
    expect(e.running).toHaveLength(0);
    expect(e.jobs).toHaveLength(0);
  });
  it("keeps dependency events attached to each originating request", () => {
    const e = run(serviceConfig(), 4);
    expect(e.state.metrics.completed).toBe(4);
    for (const result of e.state.results) {
      expect(result.trace.every((event) => event.request === result.id)).toBe(
        true,
      );
      expect(
        result.trace.filter((event) => event.edge === "backend-backend-3"),
      ).not.toHaveLength(0);
    }
    const again = run(serviceConfig(), 4);
    expect(again.state.results).toEqual(e.state.results);
  });
  it("preserves data handlers for existing cache and database scenarios", () => {
    const board = scenario("cache");
    const e = run(board.config);
    expect(e.state.results[0].status).toBe(200);
    expect(e.state.reads).toBe(1);
  });
});
describe("service board files", () => {
  it("accepts service wiring and keeps execution settings through import", () => {
    const board = scenario("empty");
    board.nodes = [
      createNode("client"),
      createNode("backend"),
      createNode("backend", "backend-2", { x: 500, y: 200 }),
      createNode("queue"),
    ];
    board.edges = [
      createEdge("client", "backend"),
      createEdge("backend", "backend-2"),
      createEdge("backend", "queue"),
    ];
    board.config.serviceOverrides = {
      backend: { mode: "handler", publish: "queue", dependencyTimeout: 1200 },
    };
    const imported = parseBoard(serializeBoard(board));
    expect(imported.config.serviceOverrides).toEqual(
      board.config.serviceOverrides,
    );
    expect(canConnect(board.nodes[1], board.nodes[2])).toBe(true);
  });
  it("rejects invalid service settings", () => {
    const board = scenario("empty");
    const raw = JSON.parse(serializeBoard(board));
    raw.config.serviceOverrides = { backend: { dependencyTimeout: -1 } };
    expect(() => parseBoard(JSON.stringify(raw))).toThrow(
      "service.dependencyTimeout",
    );
    raw.config.serviceOverrides = {
      backend: { mode: "execute arbitrary code" },
    };
    expect(() => parseBoard(JSON.stringify(raw))).toThrow("service.mode");
  });
});
