import { describe, it, expect } from "vitest";
import { Engine, defaults } from "./engine";
function run(e: Engine, path = "/users/1") {
  e.send(path);
  e.advance(3000);
  return e.state.results[0];
}
describe("cache-aside scenario", () => {
  it("misses, fills, hits, expires, and distinguishes cached success from database failure", () => {
    const e = new Engine();
    expect(run(e).source).toBe("database");
    expect(e.state.reads).toBe(1);
    expect(run(e).source).toBe("cache");
    expect(e.state.reads).toBe(1);
    e.advance(31000);
    expect(e.state.entries).toHaveLength(0);
    expect(run(e).source).toBe("database");
    expect(e.state.reads).toBe(2);
    e.configure({ ...defaults, online: false });
    expect(run(e).status).toBe(200);
    expect(run(e, "/users/2").status).toBe(503);
  });
  it("steps one decision, queues traffic, and respects dependency timeouts", () => {
    const e = new Engine();
    e.send("/users/1", 10);
    expect(e.state.queue).toBe(9);
    e.step();
    expect(e.state.events.at(-1)?.text).toContain("Route matched");
    e.advance(12000);
    expect(e.state.results).toHaveLength(10);
    expect(e.state.reads).toBe(1);
    e.configure({ ...defaults, timeout: 100 });
    e.send("/users/1");
    e.advance(100);
    expect(e.state.results[0].status).toBe(504);
  });
  it("returns the cache value even if the entry expires during the response", () => {
    const e = new Engine();
    run(e);
    e.state.entries[0].expires = e.state.now + 450;
    expect(run(e).body).toEqual(defaults.records["1"]);
    expect(e.state.results[0].source).toBe("cache");
  });
  it("enforces topology, routes, capacity, and FIFO eviction", () => {
    const e = new Engine();
    e.configure({ ...defaults, capacity: 1, eviction: "FIFO" });
    run(e);
    run(e, "/users/2");
    expect(e.state.entries.map((x) => x.key)).toEqual(["user:2"]);
    expect(run(e, "/missing").status).toBe(404);
    e.configure({ ...defaults, links: [] });
    expect(run(e).status).toBe(503);
  });
});

describe("traffic experiments", () => {
  it("limits active work, reports waiting time, and improves throughput with concurrency", () => {
    function burst(concurrency: number) {
      const e = new Engine();
      run(e);
      e.configure({ ...defaults, concurrency });
      e.send("/users/1", 10);
      expect(e.state.activeCount).toBe(concurrency);
      expect(e.state.queue).toBe(10 - concurrency);
      e.advance(6000);
      const results = e.state.results.filter((r) => r.id > 1);
      expect(results).toHaveLength(10);
      expect(e.state.activeCount).toBe(0);
      expect(e.state.queue).toBe(0);
      expect(results.some((r) => r.wait > 0)).toBe(true);
      return Math.max(...results.map((r) => r.duration));
    }
    expect(burst(4)).toBeLessThan(burst(1));
  });
  it("rejects overflow without growing the queue and drains accepted work", () => {
    const e = new Engine();
    e.configure({ ...defaults, concurrency: 2, queueLimit: 3 });
    e.send("/users/1", 10);
    expect(e.state.activeCount).toBe(2);
    expect(e.state.queue).toBe(3);
    expect(e.state.metrics.rejected).toBe(5);
    expect(e.state.results.every((r) => r.status === 429)).toBe(true);
    e.advance(6000);
    expect(e.state.metrics.completed).toBe(10);
    expect(e.state.metrics.failed).toBe(5);
    expect(e.state.results.filter((r) => r.status === 200)).toHaveLength(5);
    expect(e.state.entries.map((entry) => entry.key)).toEqual(["user:1"]);
  });
  it("schedules sustained arrivals on simulated time and stops them while draining", () => {
    const e = new Engine();
    e.configure({ ...defaults, queueLimit: 2 });
    e.setTraffic(10, "/users/1", true);
    e.advance(1000);
    expect(e.state.metrics.sent).toBe(11);
    expect(e.state.queue).toBeLessThanOrEqual(2);
    expect(e.state.metrics.rejected).toBeGreaterThan(0);
    const sent = e.state.metrics.sent;
    e.setTraffic(10, "/users/1", false);
    e.advance(6000);
    expect(e.state.metrics.sent).toBe(sent);
    expect(e.state.metrics.completed).toBe(sent);
    expect(e.state.activeCount).toBe(0);
  });
  it("reproduces the same events regardless of playback tick size", () => {
    const a = new Engine();
    const b = new Engine();
    for (const engine of [a, b]) {
      engine.configure({ ...defaults, concurrency: 3, queueLimit: 5 });
      engine.setTraffic(7, "/users/1", true);
    }
    a.advance(10000);
    for (let i = 0; i < 200; i++) b.advance(50);
    expect(a.state).toEqual(b.state);
  });
  it("finishes existing work after reducing concurrency and accepts no waiting work with a zero queue", () => {
    const e = new Engine();
    e.configure({ ...defaults, concurrency: 4, queueLimit: 0 });
    e.send("/users/1", 5);
    expect(e.state.metrics.rejected).toBe(1);
    e.configure({ ...defaults, concurrency: 1, queueLimit: 0 });
    expect(e.state.activeCount).toBe(4);
    e.advance(3000);
    expect(e.state.results.filter((r) => r.status === 200)).toHaveLength(4);
    expect(e.state.entries).toHaveLength(1);
  });
});

it("keeps every completed request trace after the live event log rolls over", () => {
  const e = new Engine();
  e.configure({ ...defaults, concurrency: 4, queueLimit: 500, ttl: 3600 });
  e.send("/users/1", 100);
  e.send("/users/1", 30);
  e.advance(100000);
  expect(e.state.results).toHaveLength(100);
  const older = e.state.results.at(-1)!;
  e.send("/users/2", 100);
  expect(e.state.events.some((event) => event.request === older.id)).toBe(
    false,
  );
  expect(
    older.trace.some((event) => event.text.includes("Route matched")),
  ).toBe(true);
  expect(older.trace.at(-1)?.text).toContain("response received");
});
