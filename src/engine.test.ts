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
