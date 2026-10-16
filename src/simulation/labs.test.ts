import { describe, it, expect } from "vitest";
import { Engine, defaults } from "./engine";
import { scenario, parseBoard, serializeBoard } from "../board/board";
import {
  cacheDefaults,
  redisCommand,
  writeCache,
  readCache,
  memoryUsed,
  type CacheState,
} from "./cache";
import {
  KafkaLab,
  kafkaDefaults,
  producerDefaults,
  consumerDefaults,
} from "./kafka";
import { QueueLab, queueDefaults, workerDefaults } from "./queue";
import { DatabaseLab, databaseDefaults } from "./database";
import { GatewayLab, gatewayDefaults } from "./gateway";
function fromScenario(kind: Parameters<typeof scenario>[0]) {
  const e = new Engine();
  e.configure(parseBoard(serializeBoard(scenario(kind))).config);
  return e;
}
describe("Redis and Memcached", () => {
  function cache() {
    return { entries: [], hits: 0, misses: 0 } as CacheState;
  }
  const redis = { ...cacheDefaults, technology: "redis" as const };
  it("executes Redis conditional writes, expiry, increments, and deletion on shared keys", () => {
    const s = cache();
    const run = (command: string, now = 0) =>
      redisCommand(s, command, now, redis, 5, "LRU");
    expect(run("SET lock owner NX EX 5")).toBe("OK");
    expect(run("SET lock other NX")).toBe("(nil)");
    expect(run("GET lock")).toBe("owner");
    expect(run("TTL lock")).toBe("(integer) 5");
    expect(run("GET lock", 5000)).toBe("(nil)");
    expect(run("TTL lock", 5000)).toBe("(integer) -2");
    expect(run("SET visits 9")).toBe("OK");
    expect(run("INCR visits")).toBe("(integer) 10");
    expect(run("PTTL visits")).toBe("(integer) -1");
    expect(run("EXPIRE visits 1")).toBe("(integer) 1");
    expect(run("DEL visits")).toBe("(integer) 1");
  });
  it("preserves TTL on INCR and removes TTL on an ordinary SET", () => {
    const s = cache();
    const run = (command: string, now = 0) =>
      redisCommand(s, command, now, redis, 5, "LRU");
    run("SET n 1 PX 500");
    run("INCR n", 100);
    expect(run("PTTL n", 100)).toBe("(integer) 400");
    run("SET n 9", 100);
    expect(run("TTL n", 100)).toBe("(integer) -1");
  });
  it("rejects malformed commands without changing existing data", () => {
    const s = cache();
    redisCommand(s, "SET x original", 0, redis, 5, "LRU");
    for (const command of [
      "SET x new EX 0",
      "SET x new NX XX",
      'SET x "broken',
      "INCR x",
      "SET x new PX wat",
      "SET x new EX 1 PX 2",
    ])
      expect(redisCommand(s, command, 0, redis, 5, "LRU")).toMatch(/^ERR/);
    expect(s.entries[0].value).toBe("original");
  });
  it("enforces memory rejection without evicting readable values", () => {
    const s = cache();
    const settings = { ...redis, maxmemory: 10, policy: "noeviction" as const };
    expect(
      writeCache(s, "a", "123456", 0, 0, settings, 5, "LRU").error,
    ).toBeUndefined();
    expect(
      writeCache(s, "b", "123456", 0, 0, settings, 5, "LRU").error,
    ).toMatch(/^OOM/);
    expect(readCache(s, "a", 1)?.value).toBe("123456");
    expect(memoryUsed(s.entries)).toBe(7);
  });
  it("evicts only expiring keys with volatile policies", () => {
    const s = cache();
    const settings = {
      ...redis,
      maxmemory: 12,
      policy: "volatile-lru" as const,
    };
    writeCache(s, "a", "12345", 0, 0, settings, 5, "LRU");
    writeCache(s, "b", "12345", 100, 1, settings, 5, "LRU");
    expect(
      writeCache(s, "c", "12345", 100, 2, settings, 5, "LRU").evicted,
    ).toEqual(["b"]);
    expect(s.entries.map((e) => e.key)).toEqual(["a", "c"]);
    expect(
      writeCache(s, "huge", "x".repeat(50), 0, 3, settings, 5, "LRU").error,
    ).toMatch(/^OOM/);
  });
  it("distinguishes LFU, LRU, and earliest expiry eviction", () => {
    for (const policy of [
      "allkeys-lfu",
      "allkeys-lru",
      "volatile-ttl",
    ] as const) {
      const s = cache(),
        settings = { ...redis, maxmemory: 12, policy };
      writeCache(s, "a", "12345", 100, 0, settings, 5, "LRU");
      writeCache(s, "b", "12345", 200, 1, settings, 5, "LRU");
      readCache(s, "a", 2);
      readCache(s, "a", 3);
      readCache(s, "b", 4);
      expect(
        writeCache(s, "c", "12345", 300, 5, settings, 5, "LRU").evicted,
      ).toEqual([policy === "allkeys-lfu" ? "b" : "a"]);
    }
  });
  it("rejects Memcached values above the configured item limit", () => {
    const s = cache();
    expect(
      writeCache(
        s,
        "x",
        "abcdefgh",
        100,
        0,
        { ...cacheDefaults, technology: "memcached", maxItemBytes: 4 },
        5,
        "LRU",
      ).error,
    ).toMatch(/too large/);
    expect(s.entries).toHaveLength(0);
  });
  it("shares Redis commands with HTTP cache-aside and bypasses an offline cache", () => {
    const e = fromScenario("redis");
    e.cacheCommand("SET user:1 overridden EX 30");
    e.send("/users/1");
    e.advance(2000);
    expect(e.state.results[0]).toMatchObject({
      source: "cache",
      body: "overridden",
    });
    e.configure({ ...e.config, cache: { ...e.config.cache, online: false } });
    e.send("/users/1");
    e.advance(2000);
    expect(e.state.results[0].source).toBe("database");
  });
});
describe("Kafka partitions and groups", () => {
  function lab(autoCommit = false) {
    const k = new KafkaLab();
    k.configure(
      { ...kafkaDefaults, partitions: 2 },
      producerDefaults,
      [{ ...consumerDefaults, id: "consumer", autoCommit }],
      true,
      true,
      0,
    );
    return k;
  }
  function advance(k: KafkaLab, target: number) {
    let steps = 0;
    while (k.nextTime() <= target) {
      if (++steps > 10000) throw new Error("Kafka failed to advance");
      k.step(k.nextTime());
    }
    k.now = target;
  }
  it("keeps a key on one partition and preserves offset order", () => {
    const k = lab();
    k.produce("same", { n: 1 }, 10, 0);
    const active = k.state.partitions.filter((p) => p.records.length);
    expect(active).toHaveLength(1);
    expect(active[0].records.map((r) => r.offset)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
    advance(k, 5000);
    expect(k.state.processed).toBe(10);
  });
  it("requires minimum ISR for acks=all but allows acks=1 with one leader", () => {
    const k = lab();
    k.configure(
      { ...k.config, inSyncReplicas: 1 },
      producerDefaults,
      k.consumers,
      true,
      true,
      0,
    );
    k.produce("x", {}, 1, 0);
    expect(k.state.rejected).toBe(1);
    k.configure(
      k.config,
      { ...producerDefaults, acks: "1" },
      k.consumers,
      true,
      true,
      0,
    );
    k.produce("x", {}, 1, 0);
    expect(k.state.produced).toBe(1);
  });
  it("assigns a partition to one member per group and broadcasts across groups", () => {
    const k = lab();
    k.configure(
      k.config,
      producerDefaults,
      [
        { ...consumerDefaults, id: "consumer" },
        { ...consumerDefaults, id: "consumer-2" },
        { ...consumerDefaults, id: "consumer-3", groupId: "audit" },
      ],
      true,
      true,
      0,
    );
    k.produce("x", {}, 1, 0);
    advance(k, 500);
    expect(k.state.groups[0].owners).toEqual(["consumer", "consumer-2"]);
    expect(k.state.processed).toBe(2);
  });
  it("replays processed records when a consumer crashes before its first commit", () => {
    const k = lab();
    k.produce("x", {}, 1, 0);
    advance(k, 500);
    expect(k.state.processed).toBe(1);
    k.configure(
      k.config,
      k.producer,
      [
        {
          ...consumerDefaults,
          id: "consumer",
          online: false,
          autoCommit: false,
        },
      ],
      true,
      true,
      500,
    );
    k.configure(
      k.config,
      k.producer,
      [{ ...consumerDefaults, id: "consumer", autoCommit: false }],
      true,
      true,
      600,
    );
    advance(k, 1100);
    expect(k.state.duplicates).toBe(1);
    expect(k.state.groups[0].committed.every((offset) => offset === -1)).toBe(
      true,
    );
  });
  it("resumes after committed positions and explicitly replays on seek", () => {
    const k = lab();
    k.produce("x", {}, 1, 0);
    advance(k, 500);
    k.commit("notifications");
    k.configure(
      k.config,
      k.producer,
      [{ ...k.consumers[0], online: false }],
      true,
      true,
      500,
    );
    k.configure(
      k.config,
      k.producer,
      [{ ...k.consumers[0], online: true }],
      true,
      true,
      600,
    );
    advance(k, 1100);
    expect(k.state.processed).toBe(1);
    k.replay("notifications", 1100);
    advance(k, 1600);
    expect(k.state.duplicates).toBe(1);
  });
  it("uses latest only for a group without committed offsets", () => {
    const k = lab();
    k.configure(k.config, k.producer, [], true, true, 0);
    k.produce("x", {}, 3, 0);
    k.configure(
      k.config,
      k.producer,
      [
        {
          ...consumerDefaults,
          id: "late",
          groupId: "late",
          offsetReset: "latest",
        },
      ],
      true,
      true,
      10,
    );
    advance(k, 1000);
    expect(k.state.processed).toBe(0);
    k.produce("x", {}, 1, 1000);
    advance(k, 1500);
    expect(k.state.processed).toBe(1);
  });
  it("retains whole sealed segments until the newest record ages out", () => {
    const k = lab();
    k.configure(
      { ...k.config, retentionMs: 2000, segmentMs: 1000 },
      k.producer,
      [],
      true,
      true,
      0,
    );
    k.produce("x", {}, 1, 0);
    k.produce("x", {}, 1, 900);
    advance(k, 2000);
    expect(k.state.partitions.flatMap((p) => p.records)).toHaveLength(2);
    advance(k, 3000);
    expect(k.state.partitions.flatMap((p) => p.records)).toHaveLength(0);
  });
  it("pauses fetch completion during broker failure and resumes on recovery", () => {
    const k = lab();
    k.produce("x", {}, 1, 0);
    k.configure(
      { ...k.config, online: false },
      k.producer,
      k.consumers,
      true,
      true,
      100,
    );
    expect(k.nextTime()).toBe(Infinity);
    k.configure(
      { ...k.config, online: true },
      k.producer,
      k.consumers,
      true,
      true,
      2000,
    );
    advance(k, 2500);
    expect(k.state.processed).toBe(1);
  });
  it("integrates Kafka decisions into shared step controls and connections", () => {
    const e = fromScenario("kafka");
    e.produce(10);
    expect(e.state.kafka.produced).toBe(10);
    e.step();
    expect(e.state.kafka.processed).toBeGreaterThan(0);
    expect(
      e.state.transit.some((t) => t.edge.startsWith("stream-consumer")),
    ).toBe(true);
    e.configure({ ...e.config, links: [] });
    e.produce();
    expect(e.state.kafka.rejected).toBe(1);
  });
});
describe("Queues and workers", () => {
  function queue(
    technology: "rabbitmq" | "sqs" = "rabbitmq",
    patch: Partial<typeof workerDefaults> = {},
  ) {
    const q = new QueueLab();
    q.configure(
      { ...queueDefaults, technology },
      [{ ...workerDefaults, ...patch, id: "worker" }],
      true,
      true,
      0,
    );
    return q;
  }
  function advance(q: QueueLab, target: number) {
    let steps = 0;
    while (q.nextTime() <= target) {
      if (++steps > 1000) throw new Error("Queue failed to advance");
      q.step(Math.max(q.now, q.nextTime()));
    }
    q.now = target;
  }
  it("limits deliveries with prefetch until acknowledgments release slots", () => {
    const q = queue("rabbitmq", { ack: "manual", prefetch: 2 });
    q.publish({}, 5, 0);
    expect(q.state.messages.filter((m) => m.state === "inflight")).toHaveLength(
      2,
    );
    advance(q, 1000);
    expect(q.state.messages.filter((m) => m.state === "unacked")).toHaveLength(
      2,
    );
    q.ackAll(1000);
    expect(q.state.acked).toBe(2);
    expect(q.state.messages.filter((m) => m.state === "inflight")).toHaveLength(
      2,
    );
  });
  it("requeues RabbitMQ unacknowledged messages when a worker disconnects", () => {
    const q = queue("rabbitmq", { ack: "manual" });
    q.publish({}, 1, 0);
    advance(q, 1000);
    q.configure(
      q.config,
      [{ ...q.workers[0], online: false }],
      true,
      true,
      1000,
    );
    expect(q.state.messages[0].state).toBe("ready");
    q.configure(
      q.config,
      [{ ...q.workers[0], online: true }],
      true,
      true,
      1000,
    );
    expect(q.state.redelivered).toBe(1);
  });
  it("keeps SQS deliveries invisible after a worker crash until visibility expires", () => {
    const q = queue("sqs");
    q.publish({}, 1, 0);
    q.configure(
      q.config,
      [{ ...q.workers[0], online: false }],
      true,
      true,
      100,
    );
    expect(q.state.messages[0].state).toBe("unacked");
    advance(q, 2999);
    expect(q.state.messages[0].state).toBe("unacked");
    advance(q, 3000);
    expect(q.state.messages[0].state).toBe("ready");
  });
  it("exposes duplicate side effects when processing exceeds SQS visibility", () => {
    const q = queue("sqs", { processingMs: 4000 });
    q.publish({}, 1, 0);
    advance(q, 3000);
    expect(q.state.messages[0].state).toBe("ready");
    expect(q.state.inProgress).toHaveLength(1);
    advance(q, 8000);
    expect(q.state.redelivered).toBeGreaterThan(0);
    expect(q.state.duplicates).toBe(1);
    expect(q.state.acked).toBe(0);
    expect(
      q.state.events.some((e) => e.text.includes("Receipt 1 expired")),
    ).toBe(true);
  });
  it("moves repeatedly failed deliveries to dead letters and redrives after repair", () => {
    const q = queue("rabbitmq", { fail: true });
    q.publish({ order: 1 }, 1, 0);
    advance(q, 3000);
    expect(q.state.messages[0].state).toBe("dead");
    q.configure(q.config, [{ ...q.workers[0], fail: false }], true, true, 3000);
    q.redrive(3000);
    advance(q, 4000);
    expect(q.state.acked).toBe(1);
    expect(q.state.messages).toHaveLength(0);
  });
  it("rejects stale receipts and disconnected publishers", () => {
    const q = queue("sqs", { ack: "manual" });
    q.publish({}, 1, 0);
    advance(q, 4000);
    q.ack(1, 1);
    expect(q.state.acked).toBe(0);
    q.configure(q.config, q.workers, true, false, 4000);
    q.publish({}, 1, 4000);
    expect(q.state.rejected).toBe(1);
  });
  it("completes queue work on the shared engine clock", () => {
    const e = fromScenario("queue");
    e.produce(10);
    e.advance(10000);
    expect(e.state.queueLab.acked).toBe(10);
    expect(e.state.queueLab.messages).toHaveLength(0);
  });
});
describe("Database and traffic controls", () => {
  it("shows committed primary writes before replica convergence", () => {
    const d = new DatabaseLab();
    d.configure(
      { ...databaseDefaults, technology: "postgresql" },
      defaults.records,
    );
    d.write({ ...defaults.records["1"], name: "Updated" }, 0, true);
    expect(d.read("1", 1).value?.name).toBe("Updated");
    d.settings.readFrom = "replica";
    expect(d.read("1", 1).value?.name).toBe("Alex Morgan");
    expect(d.read("1", 3000).value?.name).toBe("Updated");
  });
  it("models index examination cost and offline write rejection", () => {
    const d = new DatabaseLab();
    d.configure(
      { ...databaseDefaults, technology: "mongodb", indexed: false },
      defaults.records,
    );
    expect(d.read("1", 0).examined).toBe(2);
    expect(d.delay(100)).toBe(140);
    d.settings.indexed = true;
    expect(d.read("1", 0).examined).toBe(1);
    d.write({ ...defaults.records["1"], name: "Lost" }, 0, false);
    expect(d.state.primary["1"].name).toBe("Alex Morgan");
  });
  it("charges DynamoDB consistency units and recovers capacity each second", () => {
    const d = new DatabaseLab();
    d.configure(
      { ...databaseDefaults, technology: "dynamodb", readCapacity: 1 },
      defaults.records,
    );
    expect(d.read("1", 0).units).toBe(1);
    expect(d.read("1", 0).error).toContain("ProvisionedThroughputExceeded");
    d.settings.readFrom = "replica";
    expect(d.read("1", 1000).units).toBe(0.5);
    expect(d.read("1", 1000).units).toBe(0.5);
    expect(d.read("1", 1000).error).toBeDefined();
  });
  it("limits gateway bursts and refills with simulated time", () => {
    const g = new GatewayLab();
    g.configure(
      { ...gatewayDefaults, technology: "api-gateway", burst: 2, rate: 1 },
      0,
    );
    expect([g.allow(0), g.allow(0), g.allow(0)]).toEqual([true, true, false]);
    expect(g.allow(999)).toBe(false);
    expect(g.allow(1000)).toBe(true);
  });
  it("rejects gateway requests before assigning a backend", () => {
    const e = fromScenario("gateway");
    e.send("/users/1", 10);
    expect(e.state.gateway.rejected).toBe(5);
    expect(e.state.results.filter((r) => r.source === "gateway")).toHaveLength(
      5,
    );
    expect(
      Object.values(e.state.backends).reduce((sum, b) => sum + b.assigned, 0),
    ).toBe(5);
    e.advance(1000);
    expect(e.state.gateway.tokens).toBe(2);
  });
  it("remains deterministic across clock tick sizes with Kafka and HTTP work", () => {
    const a = fromScenario("kafka"),
      b = fromScenario("kafka");
    a.produce(20);
    b.produce(20);
    a.advance(10000);
    for (let i = 0; i < 100; i++) b.advance(100);
    expect(b.state.kafka).toEqual(a.state.kafka);
  });
});
describe("Technology board documents", () => {
  it.each(["redis", "kafka", "queue", "database", "gateway"] as const)(
    "round-trips the %s scenario and its settings",
    (kind) => {
      const board = scenario(kind);
      expect(parseBoard(serializeBoard(board)).config).toMatchObject(
        board.config,
      );
    },
  );
  it("preserves consumer and worker overrides and rejects invalid settings", () => {
    const board = scenario("kafka");
    board.config.consumerOverrides = {
      "consumer-2": { autoCommit: false, groupId: "audit" },
    };
    expect(parseBoard(serializeBoard(board)).config.consumerOverrides).toEqual(
      board.config.consumerOverrides,
    );
    for (const patch of [
      { kafka: { partitions: 0 } },
      { cache: { policy: "fake" } },
      { queueSettings: { visibilityMs: -1 } },
      { database: { readCapacity: Infinity } },
      { workerOverrides: { "worker-9": { online: true } } },
      { gateway: { rate: "5" } },
    ]) {
      expect(() =>
        parseBoard(
          JSON.stringify({ ...board, config: { ...board.config, ...patch } }),
        ),
      ).toThrow();
    }
  });
});

describe("Failure paths and response transit", () => {
  it("returns a gateway rejection along the gateway connection and respects an offline gateway", () => {
    const e = fromScenario("gateway");
    e.send("/users/1", 6);
    const rejected = e.state.results.find((r) => r.source === "gateway");
    expect(rejected?.trace.at(-1)).toMatchObject({
      edge: "client-balancer",
      reverse: true,
    });
    e.configure({
      ...e.config,
      balancer: { ...e.config.balancer, online: false },
    });
    e.send("/users/1");
    expect(e.state.results[0].status).toBe(503);
    expect(e.state.gateway.rejected).toBe(1);
  });
  it("returns the database response when Redis cannot cache the value", () => {
    const e = fromScenario("redis");
    e.configure({
      ...e.config,
      cache: { ...e.config.cache, maxmemory: 64, policy: "noeviction" },
    });
    e.cacheCommand(`SET lock ${"x".repeat(50)}`);
    e.send("/users/1");
    e.advance(2000);
    expect(e.state.results[0].status).toBe(200);
    expect(e.state.entries.map((entry) => entry.key)).toEqual(["lock"]);
    expect(
      e.state.results[0].trace.some((event) => event.text.startsWith("OOM")),
    ).toBe(true);
  });
  it("animates Kafka acknowledgments back to the producer", () => {
    const e = fromScenario("kafka");
    e.produce();
    expect(
      e.state.transit.some((t) => t.edge === "producer-stream" && t.reverse),
    ).toBe(true);
  });
  it("rounds Redis TTL to seconds while PTTL retains millisecond precision", () => {
    const s: CacheState = { entries: [], hits: 0, misses: 0 };
    const settings = { ...cacheDefaults, technology: "redis" as const };
    redisCommand(s, "SET x y PX 1600", 0, settings, 5, "LRU");
    expect(redisCommand(s, "TTL x", 0, settings, 5, "LRU")).toBe("(integer) 2");
    expect(redisCommand(s, "PTTL x", 0, settings, 5, "LRU")).toBe(
      "(integer) 1600",
    );
  });
});
