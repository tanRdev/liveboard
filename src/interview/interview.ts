export type CapacityInput = {
  dailyRequests: number;
  peakFactor: number;
  readPercent: number;
  responseBytes: number;
  writesPerDay: number;
  recordBytes: number;
  retentionDays: number;
  replicas: number;
};
export const capacityDefaults: CapacityInput = {
  dailyRequests: 10000000,
  peakFactor: 5,
  readPercent: 90,
  responseBytes: 2048,
  writesPerDay: 1000000,
  recordBytes: 1024,
  retentionDays: 365,
  replicas: 3,
};
export function estimateCapacity(input: CapacityInput) {
  const averageRps = input.dailyRequests / 86400,
    peakRps = averageRps * input.peakFactor;
  return {
    averageRps,
    peakRps,
    readRps: (peakRps * input.readPercent) / 100,
    writeRps: (peakRps * (100 - input.readPercent)) / 100,
    egressBytesPerSecond: peakRps * input.responseBytes,
    logicalStorageBytes:
      input.writesPerDay * input.recordBytes * input.retentionDays,
    replicatedStorageBytes:
      input.writesPerDay *
      input.recordBytes *
      input.retentionDays *
      input.replicas,
  };
}

export type InterviewBrief = {
  capacity: CapacityInput;
  prompt: string;
  requirements: string;
  assumptions: string;
  decisions: string;
  minutes: number;
  targetSuccess: number;
  targetP95: number;
  checklist: string[];
};
export const defaultBrief: InterviewBrief = {
  capacity: { ...capacityDefaults },
  prompt:
    "Design a user profile API that stays responsive during a database outage.",
  requirements:
    "Serve GET /users/:id. Explain acceptable staleness, peak traffic, and failure behavior.",
  assumptions: "",
  decisions: "",
  minutes: 45,
  targetSuccess: 99,
  targetP95: 1000,
  checklist: [],
};
export const checkpoints = [
  "Clarify scope and requirements",
  "Estimate traffic and storage",
  "Define API and data ownership",
  "Build and explain the request path",
  "Measure the baseline",
  "Introduce a failure",
  "Revise and compare the design",
  "Explain remaining trade-offs",
];
export const briefs = [
  {
    id: "profiles",
    name: "Read-heavy profile API",
    scenario: "redis" as const,
    prompt:
      "Design a profile API for a product with a large read-heavy workload.",
    requirements:
      "Define peak reads per second and acceptable staleness. Keep cached profiles available during a database outage. Explain cache expiry, a cold start, and recovery.",
  },
  {
    id: "public-api",
    name: "Public API under a burst",
    scenario: "gateway" as const,
    prompt:
      "Design a public API that protects its backend when traffic spikes.",
    requirements:
      "Define the traffic contract and HTTP 429 behavior. Set a burst allowance. Distribute accepted traffic across services. Explain how the system behaves when one service fails.",
  },
  {
    id: "notifications",
    name: "Notification delivery",
    scenario: "queue" as const,
    prompt: "Design a background notification delivery pipeline.",
    requirements:
      "Define acknowledgment timing, retries, and the dead-letter policy. Demonstrate a worker crash and redelivery. Explain duplicate side effects when processing exceeds visibility.",
  },
  {
    id: "events",
    name: "Order event fan-out",
    scenario: "kafka" as const,
    prompt:
      "Design an order event pipeline for independent downstream consumers.",
    requirements:
      "Preserve order for each customer key. Let independent groups consume the same events. Demonstrate commit and replay behavior. Explain producer acknowledgments during a replica failure.",
  },
];
export function parseBrief(value: unknown): InterviewBrief {
  if (value === undefined) return structuredClone(defaultBrief);
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid interview brief.");
  const raw = value as Record<string, unknown>,
    brief = structuredClone(defaultBrief);
  for (const key of [
    "prompt",
    "requirements",
    "assumptions",
    "decisions",
  ] as const) {
    if (raw[key] !== undefined) {
      if (typeof raw[key] !== "string" || raw[key].length > 12000)
        throw new Error(`Invalid interview ${key}.`);
      brief[key] = raw[key];
    }
  }
  for (const [key, min, max] of [
    ["minutes", 5, 180],
    ["targetSuccess", 0, 100],
    ["targetP95", 1, 60000],
  ] as const) {
    if (raw[key] !== undefined) {
      const number = raw[key];
      if (
        typeof number !== "number" ||
        !Number.isFinite(number) ||
        number < min ||
        number > max ||
        (key !== "targetSuccess" && !Number.isInteger(number))
      )
        throw new Error(`Invalid interview ${key}.`);
      brief[key] = number;
    }
  }
  if (raw.checklist !== undefined) {
    if (
      !Array.isArray(raw.checklist) ||
      raw.checklist.length > checkpoints.length ||
      raw.checklist.some(
        (v) => typeof v !== "string" || !checkpoints.includes(v),
      )
    )
      throw new Error("Invalid interview checklist.");
    brief.checklist = [...new Set(raw.checklist)] as string[];
  }
  if (raw.capacity !== undefined) {
    if (
      !raw.capacity ||
      typeof raw.capacity !== "object" ||
      Array.isArray(raw.capacity)
    )
      throw new Error("Invalid capacity estimate.");
    const values = raw.capacity as Record<string, unknown>;
    for (const [key, min, max] of [
      ["dailyRequests", 0, 1e12],
      ["peakFactor", 1, 100],
      ["readPercent", 0, 100],
      ["responseBytes", 0, 1e9],
      ["writesPerDay", 0, 1e12],
      ["recordBytes", 0, 1e9],
      ["retentionDays", 1, 36500],
      ["replicas", 1, 100],
    ] as const) {
      const v = values[key] ?? brief.capacity[key];
      if (
        typeof v !== "number" ||
        !Number.isFinite(v) ||
        !Number.isInteger(v) ||
        v < min ||
        v > max
      )
        throw new Error(`Invalid capacity ${key}.`);
      brief.capacity[key] = v;
    }
  }
  return brief;
}
