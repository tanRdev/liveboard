import { MarkerType, type Node, type Edge } from "@xyflow/react";
import { defaults, type Config, type Role } from "./engine";
export const catalog: {
  role: Role;
  name: string;
  description: string;
  category: string;
  tech: string;
}[] = [
  {
    role: "client",
    name: "Client",
    description: "Where every request begins",
    category: "APPLICATION",
    tech: "HTTP client",
  },
  {
    role: "backend",
    name: "Backend service",
    description: "Routes, logic & dependencies",
    category: "APPLICATION",
    tech: "Node.js",
  },
  {
    role: "cache",
    name: "Cache",
    description: "Fast access. Fewer reads.",
    category: "DATA & STORAGE",
    tech: "Key-value cache",
  },
  {
    role: "database",
    name: "Database",
    description: "A source of truth for your data",
    category: "DATA & STORAGE",
    tech: "Relational database",
  },
  {
    role: "balancer",
    name: "Load balancer",
    description: "Distribute traffic. Stay available.",
    category: "TRAFFIC CONTROL",
    tech: "HTTP load balancer",
  },
];
export const positions: Record<Role, { x: number; y: number }> = {
  client: { x: 40, y: 215 },
  backend: { x: 355, y: 215 },
  cache: { x: 705, y: 65 },
  database: { x: 705, y: 350 },
  balancer: { x: 355, y: 0 },
};
export function createNode(
  role: Role,
  id: string = role,
  position = positions[role],
): Node {
  const item = catalog.find((item) => item.role === role)!;
  return {
    id,
    type: "component",
    position: { ...position },
    data: {
      ...item,
      name:
        role === "backend" && id !== "backend"
          ? `Backend ${id.split("-").at(-1)}`
          : item.name,
    },
  };
}
export function createEdge(source: string, target: string): Edge {
  return {
    id: `${source}-${target}`,
    source,
    target,
    type: "traffic",
    label:
      target === "cache"
        ? "GET / SET"
        : target === "database"
          ? "QUERY"
          : "HTTP",
    markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
  };
}
export type Board = {
  version: 1;
  title: string;
  nodes: Node[];
  edges: Edge[];
  config: Config;
};
export function scenario(kind: "cache" | "balanced" | "empty"): Board {
  const config = structuredClone(defaults);
  if (kind === "empty")
    return {
      version: 1,
      title: "Untitled system",
      nodes: [],
      edges: [],
      config,
    };
  if (kind === "cache")
    return {
      version: 1,
      title: "User profile API",
      config,
      nodes: catalog
        .filter((item) => item.role !== "balancer")
        .map((item) => createNode(item.role)),
      edges: [
        createEdge("client", "backend"),
        createEdge("backend", "cache"),
        createEdge("backend", "database"),
      ],
    };
  config.backendOverrides = {
    "backend-2": { processingDelay: 700, timeout: 4000 },
  };
  return {
    version: 1,
    title: "Scale & survive",
    config,
    nodes: [
      createNode("client", "client", { x: 0, y: 235 }),
      createNode("balancer", "balancer", { x: 285, y: 235 }),
      {
        ...createNode("backend", "backend", { x: 595, y: 90 }),
        data: { ...createNode("backend").data, name: "Backend 1" },
      },
      createNode("backend", "backend-2", { x: 595, y: 380 }),
      createNode("cache", "cache", { x: 940, y: 70 }),
      createNode("database", "database", { x: 940, y: 385 }),
    ],
    edges: [
      createEdge("client", "balancer"),
      ...["backend", "backend-2"].flatMap((id) => [
        createEdge("balancer", id),
        createEdge(id, "cache"),
        createEdge(id, "database"),
      ]),
    ],
  };
}
export function serializeBoard(board: Board): string {
  return JSON.stringify(
    {
      ...board,
      nodes: board.nodes.map((n) => ({
        id: n.id,
        type: "component",
        position: n.position,
        data: { role: n.data.role, name: n.data.name, tech: n.data.tech },
      })),
      edges: board.edges.map((e) => createEdge(e.source, e.target)),
    },
    null,
    2,
  );
}
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
export function parseBoard(text: string): Board {
  if (text.length > 1_000_000)
    throw new Error("Board files must be smaller than 1 MB.");
  const value: unknown = JSON.parse(text);
  if (
    !object(value) ||
    value.version !== 1 ||
    !Array.isArray(value.nodes) ||
    !Array.isArray(value.edges) ||
    !object(value.config)
  )
    throw new Error("Choose a Liveboard JSON file with version 1.");
  if (value.nodes.length > 8 || value.edges.length > 24)
    throw new Error(
      "Boards support four backend instances and one of each other component.",
    );
  const seen = new Set<string>();
  const nodes = value.nodes.map((n: unknown): Node => {
    if (
      !object(n) ||
      !object(n.data) ||
      !object(n.position) ||
      typeof n.id !== "string" ||
      seen.has(n.id)
    )
      throw new Error("Each component needs a unique ID.");
    const role = n.data.role as Role;
    if (
      !catalog.some((c) => c.role === role) ||
      !(role === "backend" ? /^backend(?:-[2-4])?$/.test(n.id) : n.id === role)
    )
      throw new Error("The board contains an unsupported component.");
    if (
      !Number.isFinite(n.position.x) ||
      !Number.isFinite(n.position.y) ||
      Math.abs(Number(n.position.x)) > 100000 ||
      Math.abs(Number(n.position.y)) > 100000
    )
      throw new Error("Component positions must be finite board coordinates.");
    if (
      typeof n.data.name !== "string" ||
      !n.data.name.trim() ||
      n.data.name.length > 80
    )
      throw new Error("Component names must contain 1 to 80 characters.");
    seen.add(n.id);
    return {
      ...createNode(role, n.id, {
        x: Number(n.position.x),
        y: Number(n.position.y),
      }),
      data: { ...catalog.find((c) => c.role === role), name: n.data.name },
    };
  });
  const edges = value.edges.map((e: unknown) => {
    if (
      !object(e) ||
      typeof e.source !== "string" ||
      typeof e.target !== "string" ||
      !seen.has(e.source) ||
      !seen.has(e.target)
    )
      throw new Error("Connections must reference existing components.");
    const source = nodes.find((n) => n.id === e.source)!;
    const target = nodes.find((n) => n.id === e.target)!;
    if (!canConnect(source, target))
      throw new Error("The board contains an unsupported connection.");
    return createEdge(e.source, e.target);
  });
  if (new Set(edges.map((e) => e.id)).size !== edges.length)
    throw new Error("Duplicate connections are not supported.");
  const raw = value.config;
  const config = { ...structuredClone(defaults) };
  const bounds = {
    ttl: [1, 3600],
    capacity: [1, 1000],
    timeout: [1, 60000],
    concurrency: [1, 16],
    queueLimit: [0, 500],
    delay: [1, 60000],
  } as const;
  for (const key of Object.keys(bounds) as (keyof typeof bounds)[]) {
    const v = raw[key] ?? config[key];
    const [min, max] = bounds[key];
    if (
      typeof v !== "number" ||
      !Number.isFinite(v) ||
      !Number.isInteger(v) ||
      v < min ||
      v > max
    )
      throw new Error(`Invalid ${key} setting.`);
    config[key] = v;
  }
  if (raw.eviction !== "LRU" && raw.eviction !== "FIFO")
    throw new Error("Choose LRU or FIFO eviction.");
  if (
    typeof raw.online !== "boolean" ||
    typeof raw.route !== "string" ||
    !/^\/[\w/-]*:id$/.test(raw.route)
  )
    throw new Error("Routes must end with :id, such as /users/:id.");
  config.eviction = raw.eviction;
  config.online = raw.online;
  config.route = raw.route;
  if (!object(raw.records) || Object.keys(raw.records).length > 1000)
    throw new Error("Seed data must contain up to 1,000 user records.");
  config.records = Object.fromEntries(
    Object.entries(raw.records).map(([id, r]) => {
      if (
        !/^\d+$/.test(id) ||
        !object(r) ||
        r.id !== id ||
        typeof r.name !== "string" ||
        typeof r.email !== "string" ||
        r.name.length > 200 ||
        r.email.length > 200
      )
        throw new Error(
          "Each user record needs a numeric ID, name, and email.",
        );
      return [id, { id, name: r.name, email: r.email }];
    }),
  );
  if (raw.balancer !== undefined) {
    if (
      !object(raw.balancer) ||
      !["round-robin", "least-connections"].includes(
        String(raw.balancer.policy),
      ) ||
      typeof raw.balancer.online !== "boolean"
    )
      throw new Error("Invalid load balancer settings.");
    config.balancer = {
      policy: raw.balancer.policy as Config["balancer"]["policy"],
      online: raw.balancer.online,
    };
  }
  if (raw.backendOverrides !== undefined) {
    if (!object(raw.backendOverrides))
      throw new Error("Invalid backend settings.");
    config.backendOverrides = {};
    for (const [id, settings] of Object.entries(raw.backendOverrides)) {
      if (!/^backend(?:-[2-4])?$/.test(id) || !object(settings))
        throw new Error("Invalid backend instance.");
      const valid: Record<string, number | string | boolean> = {};
      for (const [key, v] of Object.entries(settings)) {
        if (key === "online") {
          if (typeof v !== "boolean")
            throw new Error("Invalid backend health.");
          valid[key] = v;
        } else if (key === "route") {
          if (typeof v !== "string" || !/^\/[\w/-]*:id$/.test(v))
            throw new Error("Invalid backend route.");
          valid[key] = v;
        } else {
          const range =
            key === "processingDelay"
              ? [0, 60000]
              : bounds[key as keyof typeof bounds];
          if (
            !range ||
            ![
              "concurrency",
              "queueLimit",
              "timeout",
              "processingDelay",
            ].includes(key) ||
            typeof v !== "number" ||
            !Number.isInteger(v) ||
            v < range[0] ||
            v > range[1]
          )
            throw new Error("Invalid backend limits.");
          valid[key] = v;
        }
      }
      config.backendOverrides[id] = valid;
    }
  }
  config.components = nodes.map((n) => ({
    id: n.id,
    role: n.data.role as Role,
    name: String(n.data.name),
  }));
  config.roles = nodes.map((n) => n.data.role as Role);
  config.links = edges.map((e) => e.id);
  return {
    version: 1,
    title:
      typeof value.title === "string"
        ? value.title.slice(0, 80)
        : "Imported board",
    nodes,
    edges,
    config,
  };
}
export function canConnect(source: Node, target: Node): boolean {
  return (
    source.id !== target.id &&
    ((source.data.role === "client" &&
      ["backend", "balancer"].includes(String(target.data.role))) ||
      (source.data.role === "balancer" && target.data.role === "backend") ||
      (source.data.role === "backend" &&
        ["cache", "database"].includes(String(target.data.role))))
  );
}
