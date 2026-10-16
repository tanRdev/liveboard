import type { Config, Role } from "./engine";
import type { ConsumerConfig } from "./kafka";
import type { WorkerConfig } from "./queue";
type Rule = readonly string[] | readonly [number, number] | "boolean" | "text";
const schemas: Record<string, Record<string, Rule>> = {
  cache: {
    technology: ["generic", "redis", "memcached"],
    online: "boolean",
    maxmemory: [64, 1000000],
    policy: [
      "allkeys-lru",
      "allkeys-lfu",
      "volatile-lru",
      "volatile-ttl",
      "noeviction",
    ],
    maxItemBytes: [1, 1000000],
  },
  kafka: {
    topic: "text",
    partitions: [1, 12],
    replicationFactor: [1, 5],
    minISR: [1, 5],
    inSyncReplicas: [0, 5],
    retentionMs: [1000, 3600000],
    segmentMs: [1000, 60000],
    online: "boolean",
    assignor: ["range", "round-robin"],
  },
  producer: {
    acks: ["all", "1"],
    partitioner: ["key-hash", "round-robin"],
    key: "text",
    payload: "text",
  },
  consumer: {
    groupId: "text",
    online: "boolean",
    autoCommit: "boolean",
    commitInterval: [100, 60000],
    offsetReset: ["earliest", "latest"],
    processingMs: [1, 60000],
  },
  queueSettings: {
    technology: ["rabbitmq", "sqs"],
    online: "boolean",
    visibilityMs: [100, 60000],
    maxDeliveries: [1, 20],
    capacity: [1, 500],
  },
  worker: {
    online: "boolean",
    prefetch: [1, 16],
    processingMs: [1, 60000],
    ack: ["automatic", "manual"],
    fail: "boolean",
  },
  database: {
    technology: ["generic", "postgresql", "mongodb", "dynamodb"],
    readFrom: ["primary", "replica"],
    indexed: "boolean",
    replicationMs: [0, 60000],
    readCapacity: [1, 100],
  },
  resilience: {
    attemptTimeout: [1, 60000],
    maxRetries: [0, 3],
    backoffMs: [0, 60000],
    backoff: ["fixed", "exponential"],
    breaker: "boolean",
    failureThreshold: [1, 100],
    resetMs: [1, 60000],
  },
  connection: {
    latency: [0, 60000],
    failureEvery: [0, 100],
    online: "boolean",
  },
  gateway: {
    technology: ["load-balancer", "api-gateway"],
    rate: [1, 100],
    burst: [1, 100],
  },
};
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function validate(value: unknown, schema: string): Record<string, unknown> {
  if (!object(value)) throw new Error(`Invalid ${schema} settings.`);
  for (const [key, v] of Object.entries(value)) {
    const rule = schemas[schema][key];
    let valid = false;
    if (rule === "boolean") valid = typeof v === "boolean";
    else if (rule === "text")
      valid =
        typeof v === "string" &&
        v.length <= 4096 &&
        (schema === "producer" || v.trim().length > 0) &&
        !/[\u0000-\u001f]/.test(
          schema === "producer" && key === "payload" ? "" : String(v),
        );
    else if (Array.isArray(rule)) {
      valid =
        typeof rule[0] === "number"
          ? typeof v === "number" &&
            Number.isInteger(v) &&
            v >= Number(rule[0]) &&
            v <= Number(rule[1])
          : rule.includes(v as never);
    }
    if (!valid) throw new Error(`Invalid ${schema}.${key} setting.`);
  }
  return value;
}
export function parseSettings(raw: Record<string, unknown>, config: Config) {
  for (const key of [
    "cache",
    "kafka",
    "producer",
    "queueSettings",
    "database",
    "gateway",
  ] as const) {
    if (raw[key] !== undefined)
      Object.assign(config[key], validate(raw[key], key));
  }
  if (
    config.kafka.minISR > config.kafka.replicationFactor ||
    config.kafka.inSyncReplicas > config.kafka.replicationFactor
  )
    throw new Error("ISR settings cannot exceed the replication factor.");
  for (const [key, role] of [
    ["consumerOverrides", "consumer"],
    ["workerOverrides", "worker"],
  ] as const) {
    if (raw[key] === undefined) continue;
    if (!object(raw[key])) throw new Error(`Invalid ${key}.`);
    const entries = Object.entries(raw[key]);
    if (entries.length > 8)
      throw new Error(`At most eight ${role} instances are supported.`);
    for (const [id, settings] of entries) {
      if (!new RegExp(`^${role}(?:-[2-8])?$`).test(id))
        throw new Error(`Invalid ${role} identity.`);
      const valid = validate(settings, role);
      if (key === "consumerOverrides")
        config.consumerOverrides[id] = valid as Partial<ConsumerConfig>;
      else config.workerOverrides[id] = valid as Partial<WorkerConfig>;
    }
  }
  for (const [key, schema] of [
    ["resilienceOverrides", "resilience"],
    ["connectionOverrides", "connection"],
  ] as const) {
    if (raw[key] === undefined) continue;
    if (!object(raw[key]) || Object.keys(raw[key]).length > 8)
      throw new Error(`Invalid ${key}.`);
    for (const [id, value] of Object.entries(raw[key])) {
      if (
        !(
          key === "resilienceOverrides"
            ? /^backend(?:-[2-8])?$/
            : /^backend(?:-[2-8])?-database$/
        ).test(id)
      )
        throw new Error(`Invalid ${schema} identity.`);
      const valid = validate(value, schema);
      Object.assign(config[key], { [id]: valid });
    }
  }
}
export function technology(role: Role, config: Config): string {
  if (role === "cache")
    return {
      generic: "Key-value cache",
      redis: "Redis",
      memcached: "Memcached",
    }[config.cache.technology];
  if (role === "database")
    return {
      generic: "Relational database",
      postgresql: "PostgreSQL",
      mongodb: "MongoDB",
      dynamodb: "DynamoDB",
    }[config.database.technology];
  if (role === "balancer")
    return config.gateway.technology === "api-gateway"
      ? "API gateway"
      : "HTTP load balancer";
  if (role === "queue")
    return config.queueSettings.technology === "rabbitmq"
      ? "RabbitMQ quorum queue"
      : "Amazon SQS Standard";
  return (
    {
      client: "HTTP client",
      backend: "Node.js",
      stream: "Apache Kafka",
      producer: "Event producer",
      consumer: "Kafka consumer",
      worker: "Message worker",
    }[role] ?? ""
  );
}

export function technologyReference(
  role: Role,
  config: Config,
): string | undefined {
  if (role === "cache")
    return {
      generic: undefined,
      redis: "https://redis.io/docs/latest/develop/reference/eviction/",
      memcached: "https://docs.memcached.org/serverguide/configuring/",
    }[config.cache.technology];
  if (role === "stream" || role === "producer")
    return "https://kafka.apache.org/42/configuration/topic-configs/";
  if (role === "consumer")
    return "https://kafka.apache.org/42/configuration/consumer-configs/";
  if (role === "queue" || role === "worker")
    return config.queueSettings.technology === "sqs"
      ? "https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-visibility-timeout.html"
      : "https://www.rabbitmq.com/docs/confirms";
  if (role === "database")
    return {
      generic: undefined,
      postgresql: "https://www.postgresql.org/docs/current/warm-standby.html",
      mongodb: "https://www.mongodb.com/docs/manual/core/read-preference/",
      dynamodb:
        "https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.ReadConsistency.html",
    }[config.database.technology];
}
