import { createEdge, createNode, executionConfig, type Board } from "./board";
import { defaults } from "./engine";
import { defaultBrief } from "./interview";

export function checkoutScenario(): Board {
  const config = structuredClone(defaults);
  config.route = "/checkout/:id";
  config.concurrency = 6;
  config.queueLimit = 20;
  config.timeout = 2500;
  config.backendOverrides = {
    backend: { processingDelay: 80 },
    "backend-2": {
      route: "/inventory/:id",
      concurrency: 4,
      processingDelay: 250,
    },
    "backend-3": {
      route: "/payments/:id",
      concurrency: 4,
      processingDelay: 600,
    },
  };
  config.serviceOverrides = {
    backend: {
      mode: "handler",
      calls: "parallel",
      dependencyTimeout: 2000,
      publish: "queue",
    },
    "backend-2": { mode: "handler" },
    "backend-3": { mode: "handler" },
  };
  config.workerOverrides = {
    worker: { processingMs: 300, prefetch: 4, ack: "automatic" },
  };
  const service = (id: string, name: string, x: number, y: number) => {
    const node = createNode("backend", id, { x, y });
    node.data.name = name;
    return node;
  };
  const board: Board = {
    version: 1,
    title: "Checkout · dependencies & fulfillment",
    config,
    nodes: [
      createNode("client", "client", { x: 0, y: 260 }),
      service("backend", "Checkout API", 330, 260),
      service("backend-2", "Inventory service", 710, 20),
      service("backend-3", "Payments service", 710, 390),
      {
        ...createNode("queue", "queue", { x: 1070, y: 140 }),
        data: { ...createNode("queue").data, name: "Fulfillment queue" },
      },
      {
        ...createNode("worker", "worker", { x: 1410, y: 140 }),
        data: { ...createNode("worker").data, name: "Fulfillment worker" },
      },
    ],
    edges: [
      createEdge("client", "backend"),
      createEdge("backend", "backend-2"),
      createEdge("backend", "backend-3"),
      createEdge("backend", "queue"),
      createEdge("queue", "worker"),
    ],
    interview: {
      ...structuredClone(defaultBrief),
      prompt:
        "Design a checkout API that calls inventory and payments before it queues fulfillment.",
      requirements:
        "Serve /checkout/:id at three requests per second. Complete both dependency calls before publishing fulfillment. Target 99% successful requests and a response P95 below 1,800 ms. Explain capacity allocation, parallel calls, and failure propagation.",
      assumptions:
        "Each request models one checkout. Inventory and payments are timed service handlers. The queue models delivery and acknowledgments.",
      targetP95: 1800,
    },
  };
  board.config = executionConfig(board);
  return board;
}
