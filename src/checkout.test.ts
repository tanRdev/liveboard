import { describe, expect, it } from "vitest";
import { checkoutScenario } from "./checkout";
import { executionConfig, parseBoard, serializeBoard } from "./board";
import { Engine } from "./engine";
import { checkConstraints } from "./challenges";
import { challengeCatalog } from "./challengeCatalog";

function run(board = checkoutScenario(), count = 1) {
  const engine = new Engine();
  engine.configure(executionConfig(board));
  engine.send("/checkout/1", count);
  engine.advance(10000);
  return engine.state;
}

describe("Checkout interview scenario", () => {
  it("returns both dependency results before it publishes fulfillment", () => {
    const state = run();
    expect(state.results).toHaveLength(1);
    const result = state.results[0];
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      service: "Checkout API",
      dependencies: {
        "backend-2": { service: "Inventory service" },
        "backend-3": { service: "Payments service" },
      },
    });
    expect(
      result.trace.some((event) => event.text.includes("GET /inventory/1")),
    ).toBe(true);
    expect(
      result.trace.some((event) => event.text.includes("GET /payments/1")),
    ).toBe(true);
    expect(state.queueLab.published).toBe(1);
    expect(state.queueLab.processed).toBe(1);
    const publish = result.trace.findIndex((event) =>
      event.text.includes("Published fulfillment"),
    );
    for (const id of ["backend-2", "backend-3"])
      expect(
        result.trace.findIndex(
          (event) => event.component === id && event.text.includes("return to"),
        ),
      ).toBeLessThan(publish);
  });

  it("propagates a payment outage without publishing fulfillment", () => {
    const board = checkoutScenario();
    board.config.backendOverrides!["backend-3"].online = false;
    const state = run(board);
    expect(state.results[0].status).toBe(503);
    expect(state.queueLab.published).toBe(0);
    expect(state.results[0].trace.some((event) => event.kind === "error")).toBe(
      true,
    );
  });

  it("does not acknowledge checkout when the fulfillment queue rejects it", () => {
    const board = checkoutScenario();
    board.config.queueSettings.online = false;
    const state = run(board);
    expect(state.results[0].status).toBe(503);
    expect(state.queueLab.published).toBe(0);
  });

  it("preserves the full runnable system across board exports", () => {
    const board = parseBoard(serializeBoard(checkoutScenario()));
    expect(board.config.serviceOverrides.backend.publish).toBe("queue");
    expect(run(board).results[0].status).toBe(200);
  });

  it("prevents candidates from removing required calls or fulfillment", () => {
    const definition = challengeCatalog.find(
      (item) => item.id === "checkout-capacity",
    )!;
    const board = structuredClone(definition.starter);
    board.config.serviceOverrides.backend.publish = "none";
    expect(
      checkConstraints(definition, board).find(
        (check) => check.id === "locked-services",
      )?.passed,
    ).toBe(false);
    board.edges = board.edges.filter((edge) => edge.id !== "backend-backend-3");
    expect(
      checkConstraints(definition, board).find(
        (check) => check.id === "locked-connections",
      )?.passed,
    ).toBe(false);
  });
});
