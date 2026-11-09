import { describe, expect, it } from "vitest";
import { executionConfig, scenario } from "../board/board";
import { Engine } from "./engine";
import { clockKey, slimSnapshot } from "./publish";
import { createSimulationHost, snapshotFrom } from "./simulationHost";

describe("snapshot publishing", () => {
  it("ignores the simulation clock and drops duplicated result traces", () => {
    const engine = new Engine();
    engine.configure(executionConfig(scenario("cache")));
    engine.send("/users/1");
    while (!engine.state.results.length) engine.advance(50);
    const before = clockKey(engine.state);
    engine.state.now += 50;
    expect(clockKey(engine.state)).toBe(before);
    expect(engine.state.results[0].trace.length).toBeGreaterThan(0);
    const slim = slimSnapshot(engine.state);
    expect(slim.results[0].trace).toEqual([]);
    expect(engine.state.results[0].trace.length).toBeGreaterThan(0);
    expect(slim.events.length).toBeGreaterThan(0);
  });

  it("does not post another snapshot when a tick only moves the clock", () => {
    const messages: unknown[] = [];
    const host = createSimulationHost((message) => messages.push(message));
    host.publish();
    host.tick();
    const count = messages.length;
    host.tick();
    host.tick();
    expect(messages.length).toBe(count);
    host.handle({ type: "send", path: "/users/1", count: 1 });
    expect(messages.length).toBeGreaterThan(count);
    const state = snapshotFrom(messages);
    expect(state?.metrics.sent).toBe(1);
  });
});
