import { describe, expect, it } from "vitest";
import { parseBoard, serializeBoard, scenario, topologyKey } from "./board";
describe("board documents", () => {
  it.each(["empty", "cache", "balanced"] as const)(
    "round-trips the %s board without transient state",
    (kind) => {
      const board = scenario(kind);
      board.nodes.forEach((node) => {
        node.data.state = { secret: "execution-only" };
      });
      const text = serializeBoard(board);
      expect(text).not.toContain("execution-only");
      const restored = parseBoard(text);
      expect(restored.nodes.map((n) => n.id)).toEqual(
        board.nodes.map((n) => n.id),
      );
      expect(restored.edges.map((e) => e.id)).toEqual(
        board.edges.map((e) => e.id),
      );
      expect(restored.config.balancer).toEqual(board.config.balancer);
    },
  );
  it("restores older boards without load balancer settings", () => {
    const raw = JSON.parse(serializeBoard(scenario("cache")));
    delete raw.config.balancer;
    delete raw.config.concurrency;
    delete raw.config.queueLimit;
    expect(parseBoard(JSON.stringify(raw)).config).toMatchObject({
      concurrency: 1,
      queueLimit: 50,
      balancer: { policy: "round-robin", online: true },
    });
  });
  it("preserves per-instance limits, routes, delays, and health", () => {
    const board = scenario("balanced");
    board.config.backendOverrides = {
      "backend-2": {
        online: false,
        concurrency: 4,
        timeout: 5000,
        queueLimit: 20,
        route: "/people/:id",
        processingDelay: 300,
      },
    };
    expect(parseBoard(serializeBoard(board)).config.backendOverrides).toEqual(
      board.config.backendOverrides,
    );
  });
  it.each([
    ["duplicate IDs", (b: any) => b.nodes.push(b.nodes[0])],
    [
      "dangling connections",
      (b: any) => b.edges.push({ source: "ghost", target: "cache" }),
    ],
    [
      "unsupported connections",
      (b: any) => b.edges.push({ source: "cache", target: "database" }),
    ],
    ["zero capacity", (b: any) => (b.config.capacity = 0)],
    ["invalid route", (b: any) => (b.config.route = "/users")],
    [
      "invalid backend health",
      (b: any) =>
        (b.config.backendOverrides = { backend: { online: "false" } }),
    ],
    ["infinite positions", (b: any) => (b.nodes[0].position.x = Infinity)],
    ["unsupported node role", (b: any) => (b.nodes[0].data.role = "unknown")],
    ["empty names", (b: any) => (b.nodes[0].data.name = "")],
  ])("rejects %s", (_, mutate) => {
    const raw = JSON.parse(serializeBoard(scenario("cache")));
    mutate(raw);
    expect(() => parseBoard(JSON.stringify(raw))).toThrow();
  });
  it("ignores node position when deciding whether the engine must reconfigure", () => {
    const board = scenario("cache");
    const moved = board.nodes.map((node) => ({
      ...node,
      position: { x: node.position.x + 40, y: node.position.y },
    }));
    expect(topologyKey(moved, board.edges, board.config)).toBe(
      topologyKey(board.nodes, board.edges, board.config),
    );
    expect(
      topologyKey(
        board.nodes,
        [...board.edges, { ...board.edges[0], source: "cache", target: "client" }],
        board.config,
      ),
    ).not.toBe(topologyKey(board.nodes, board.edges, board.config));
  });
  it("rejects oversized and malformed input", () => {
    expect(() => parseBoard("x".repeat(1_000_001))).toThrow(/1 MB/);
    expect(() => parseBoard("{")).toThrow();
  });
});
