import { describe, expect, it } from "vitest";
import { createEdge, createNode, executionConfig, scenario } from "../board/board";
import { defaults } from "./engine";
import { createSimulationHost, snapshotFrom } from "./simulationHost";

describe("simulation worker host", () => {
  it("routes a direct multi-backend configure and send through the worker protocol", () => {
    const messages: unknown[] = [];
    const host = createSimulationHost((message) => messages.push(message));
    const board = scenario("empty");
    board.nodes = [
      createNode("client"),
      createNode("backend", "backend", { x: 280, y: 40 }),
      createNode("backend", "backend-2", { x: 280, y: 280 }),
      createNode("database"),
    ];
    board.edges = [
      createEdge("client", "backend"),
      createEdge("client", "backend-2"),
      createEdge("backend", "database"),
      createEdge("backend-2", "database"),
    ];
    host.handle({
      type: "configure",
      config: { ...defaults, ...executionConfig(board) },
    });
    host.handle({ type: "send", path: "/users/1", count: 4 });
    const state = snapshotFrom(messages);
    expect(state?.backends.backend.assigned).toBe(2);
    expect(state?.backends["backend-2"].assigned).toBe(2);
  });
});
