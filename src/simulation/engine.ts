import { serviceSettings, type ServiceSettings } from "./services";
import {
  CircuitBank,
  connectionDefaults,
  resilienceDefaults,
  retryDelay,
  type CircuitState,
  type ResilienceSettings,
  type ConnectionSettings,
} from "./resilience";
import {
  cacheDefaults,
  readCache,
  writeCache,
  redisCommand,
  type CacheSettings,
  type CacheEntry,
} from "./cache";
import {
  KafkaLab,
  emptyKafka,
  kafkaDefaults,
  producerDefaults,
  consumerDefaults,
  type KafkaConfig,
  type ProducerConfig,
  type ConsumerConfig,
  type KafkaSnapshot,
} from "./kafka";
import {
  QueueLab,
  emptyQueue,
  queueDefaults,
  workerDefaults,
  type QueueConfig,
  type WorkerConfig,
  type QueueSnapshot,
} from "./queue";
import {
  DatabaseLab,
  emptyDatabase,
  databaseDefaults,
  type DatabaseSettings,
  type DatabaseSnapshot,
} from "./database";
import {
  GatewayLab,
  gatewayDefaults,
  type GatewaySettings,
  type GatewaySnapshot,
} from "./gateway";
export type Role =
  | "client"
  | "backend"
  | "cache"
  | "database"
  | "balancer"
  | "producer"
  | "stream"
  | "consumer"
  | "queue"
  | "worker";
export type BackendSettings = {
  concurrency: number;
  queueLimit: number;
  timeout: number;
  route: string;
  online: boolean;
  processingDelay: number;
};
export type Component = { id: string; role: Role; name: string };
export type BackendState = BackendSettings & {
  name: string;
  active: number;
  reachable: boolean;
  queued: number;
  assigned: number;
  completed: number;
  failed: number;
  rejected: number;
};
export type Transit = {
  edge: string;
  reverse: boolean;
  until: number;
  request: number;
};
export type Config = {
  serviceOverrides: Record<string, Partial<ServiceSettings>>;
  resilienceOverrides: Record<string, Partial<ResilienceSettings>>;
  connectionOverrides: Record<string, Partial<ConnectionSettings>>;
  cache: CacheSettings;
  kafka: KafkaConfig;
  producer: ProducerConfig;
  consumerOverrides: Record<string, Partial<ConsumerConfig>>;
  queueSettings: QueueConfig;
  workerOverrides: Record<string, Partial<WorkerConfig>>;
  database: DatabaseSettings;
  gateway: GatewaySettings;
  ttl: number;
  capacity: number;
  eviction: "LRU" | "FIFO";
  timeout: number;
  concurrency: number;
  queueLimit: number;
  delay: number;
  online: boolean;
  route: string;
  records: Record<string, { id: string; name: string; email: string }>;
  roles: Role[];
  links: string[];
  components?: Component[];
  backendOverrides?: Record<string, Partial<BackendSettings>>;
  balancer: { policy: "round-robin" | "least-connections"; online: boolean };
};
export const defaults: Config = {
  serviceOverrides: {},
  resilienceOverrides: {},
  connectionOverrides: {},
  cache: { ...cacheDefaults },
  kafka: { ...kafkaDefaults },
  producer: { ...producerDefaults },
  consumerOverrides: {},
  queueSettings: { ...queueDefaults },
  workerOverrides: {},
  database: { ...databaseDefaults },
  gateway: { ...gatewayDefaults },
  balancer: { policy: "round-robin", online: true },
  ttl: 30,
  capacity: 5,
  eviction: "LRU",
  timeout: 2000,
  concurrency: 1,
  queueLimit: 50,
  delay: 600,
  online: true,
  route: "/users/:id",
  records: {
    "1": { id: "1", name: "Alex Morgan", email: "alex@example.com" },
    "2": { id: "2", name: "Jamie Chen", email: "jamie@example.com" },
  },
  roles: ["client", "backend", "cache", "database"],
  links: ["client-backend", "backend-cache", "backend-database"],
};
export function resilienceSettings(
  config: Config,
  id: string,
): ResilienceSettings {
  return { ...resilienceDefaults, ...config.resilienceOverrides?.[id] };
}
export function connectionSettings(
  config: Config,
  id: string,
): ConnectionSettings {
  return { ...connectionDefaults, ...config.connectionOverrides?.[id] };
}
export function backendSettings(config: Config, id: string): BackendSettings {
  return {
    concurrency: config.concurrency,
    queueLimit: config.queueLimit,
    timeout: config.timeout,
    route: config.route,
    online: true,
    processingDelay: 0,
    ...config.backendOverrides?.[id],
  };
}
export function consumerSettings(config: Config, id: string): ConsumerConfig {
  return { ...consumerDefaults, ...config.consumerOverrides?.[id] };
}
export function workerSettings(config: Config, id: string): WorkerConfig {
  return { ...workerDefaults, ...config.workerOverrides?.[id] };
}
export function components(config: Config): Component[] {
  return (
    config.components ??
    config.roles.map((role) => ({ id: role, role, name: role }))
  );
}
export function initialSnapshot(): Snapshot {
  return {
    circuits: {},
    kafka: emptyKafka(),
    queueLab: emptyQueue(),
    database: emptyDatabase(),
    gateway: { tokens: 10, allowed: 0, rejected: 0 },
    cacheLog: [],
    now: 0,
    events: [],
    results: [],
    entries: [],
    reads: 0,
    hits: 0,
    misses: 0,
    queue: 0,
    active: false,
    activeCount: 0,
    peakQueue: 0,
    metrics: {
      sent: 0,
      completed: 0,
      failed: 0,
      rejected: 0,
      totalDuration: 0,
      totalWait: 0,
    },
    traffic: { running: false, rate: 5, path: "/users/1" },
    backends: {},
    transit: [],
  };
}
export type Trace = {
  id: number;
  request: number;
  time: number;
  component: string;
  text: string;
  kind: "info" | "hit" | "miss" | "error";
  edge?: string;
  reverse?: boolean;
};
export type Result = {
  id: number;
  path: string;
  status: number;
  body: unknown;
  duration: number;
  wait: number;
  source: string;
  backendId?: string;
  backendName?: string;
  trace: Trace[];
};
type Job = {
  parent?: Job;
  rootId?: number;
  children?: number[];
  targets?: string[];
  responses?: Record<string, unknown>;
  dependencyDeadline?: number;
  completed?: boolean;
  attempt?: number;
  attemptDeadline?: number;
  generation?: number;
  dependencyFault?: boolean;
  id: number;
  path: string;
  start: number;
  key: string;
  stage: number;
  deadline: number;
  due: number;
  startedAt: number;
  body?: unknown;
  backendId?: string;
  backendName?: string;
  viaBalancer?: boolean;
  responseSource?: string;
  trace: Trace[];
};
export type Snapshot = {
  circuits: Record<string, CircuitState>;
  now: number;
  events: Trace[];
  results: Result[];
  kafka: KafkaSnapshot;
  queueLab: QueueSnapshot;
  database: DatabaseSnapshot;
  gateway: GatewaySnapshot;
  cacheLog: { id: number; time: number; command: string; reply: string }[];
  entries: CacheEntry[];
  reads: number;
  hits: number;
  misses: number;
  queue: number;
  active: boolean;
  activeCount: number;
  peakQueue: number;
  metrics: {
    sent: number;
    completed: number;
    failed: number;
    rejected: number;
    totalDuration: number;
    totalWait: number;
  };
  traffic: { running: boolean; rate: number; path: string };
  edge?: string;
  reverse?: boolean;
  backends: Record<string, BackendState>;
  transit: Transit[];
};
export class Engine {
  config: Config = structuredClone(defaults);
  state: Snapshot = initialSnapshot();
  jobs: Job[] = [];
  current?: Job;
  running: Job[] = [];
  nextArrival = Infinity;
  nextId = 1;
  nextCallId = -1;
  eventId = 1;
  edgeUntil = 0;
  roundRobin = 0;
  circuits = new CircuitBank();
  kafka = new KafkaLab((event) => this.labEvent(event.edge, event.reverse));
  queueLab = new QueueLab((event) => this.labEvent(event.edge, event.reverse));
  database = new DatabaseLab();
  gateway = new GatewayLab();
  labEvent(edge?: string, reverse = false) {
    if (edge)
      this.state.transit = [
        ...this.state.transit,
        { edge, reverse, request: -1, until: this.state.now + 350 },
      ].slice(-80);
  }
  syncLabs() {
    this.state.circuits = this.circuits.states;
    this.state.kafka = this.kafka.state;
    this.state.queueLab = this.queueLab.state;
    this.state.database = this.database.state;
    this.state.gateway = this.gateway.state;
  }
  produce(count = 1) {
    let value: unknown = this.config.producer.payload;
    try {
      value = JSON.parse(this.config.producer.payload);
    } catch {
      /* Plain strings are valid message values. */
    }
    if (this.hasRole("stream"))
      this.kafka.produce(
        this.config.producer.key,
        value,
        count,
        this.state.now,
      );
    if (this.hasRole("queue"))
      this.queueLab.publish(value, count, this.state.now);
    this.syncLabs();
  }
  cacheCommand(command: string) {
    if (!this.hasRole("cache")) return;
    const reply = redisCommand(
      this.state,
      command,
      this.state.now,
      this.config.cache,
      this.config.capacity,
      this.config.eviction,
    );
    this.state.cacheLog.push({
      id: this.eventId++,
      time: this.state.now,
      command,
      reply,
    });
    this.state.cacheLog = this.state.cacheLog.slice(-50);
  }
  constructor(private onResult: (result: Result) => void = () => {}) {
    this.database.configure(this.config.database, this.config.records);
    this.syncLabs();
    this.refreshBackends();
  }
  configure(config: Config) {
    this.config = { ...structuredClone(defaults), ...structuredClone(config) };
    this.config.concurrency = this.limit(this.config.concurrency, 1, 16);
    this.config.queueLimit = this.limit(this.config.queueLimit, 0, 500);
    for (const [id, settings] of Object.entries(
      this.config.backendOverrides ?? {},
    )) {
      this.config.backendOverrides![id] = {
        ...settings,
        concurrency: this.limit(
          settings.concurrency ?? this.config.concurrency,
          1,
          16,
        ),
        queueLimit: this.limit(
          settings.queueLimit ?? this.config.queueLimit,
          0,
          500,
        ),
        timeout: this.limit(settings.timeout ?? this.config.timeout, 1, 60000),
        processingDelay: this.limit(settings.processingDelay ?? 0, 0, 60000),
      };
    }
    const parts = components(this.config);
    this.kafka.configure(
      this.config.kafka,
      this.config.producer,
      parts
        .filter((c) => c.role === "consumer" && this.connected("stream", c.id))
        .map((c) => ({ id: c.id, ...consumerSettings(this.config, c.id) })),
      this.hasRole("stream"),
      this.hasRole("producer") && this.connected("producer", "stream"),
      this.state.now,
    );
    this.queueLab.configure(
      this.config.queueSettings,
      parts
        .filter((c) => c.role === "worker" && this.connected("queue", c.id))
        .map((c) => ({ id: c.id, ...workerSettings(this.config, c.id) })),
      this.hasRole("queue"),
      this.hasRole("producer") && this.connected("producer", "queue"),
      this.state.now,
    );
    this.database.configure(this.config.database, this.config.records);
    this.gateway.configure(this.config.gateway, this.state.now);
    this.syncLabs();
    const ids = new Set(
      parts.filter((c) => c.role === "backend").map((c) => c.id),
    );
    for (const id of Object.keys(this.circuits.states))
      if (!ids.has(id)) delete this.circuits.states[id];
    this.refreshBackends();
    const removed = this.running.filter(
      (job) => !this.state.backends[job.backendId!],
    );
    this.running = this.running.filter(
      (job) => this.state.backends[job.backendId!],
    );
    for (const job of removed)
      this.complete(job, 503, { error: "Assigned backend removed" }, "backend");
    const cancelled = this.jobs.filter(
      (job) => !this.state.backends[job.backendId!]?.online,
    );
    this.jobs = this.jobs.filter(
      (job) => this.state.backends[job.backendId!]?.online,
    );
    for (const job of cancelled) {
      job.startedAt = this.state.now;
      this.complete(
        job,
        503,
        { error: "Assigned backend unavailable" },
        "backend",
      );
    }
    this.startNext();
  }
  refreshBackends() {
    const previous = this.state.backends;
    this.state.backends = Object.fromEntries(
      components(this.config)
        .filter((node) => node.role === "backend")
        .map((node) => {
          const stats = previous[node.id];
          return [
            node.id,
            {
              ...backendSettings(this.config, node.id),
              name: node.name,
              reachable:
                this.hasRole("balancer") && this.connected("client", "balancer")
                  ? this.config.balancer.online &&
                    this.connected("balancer", node.id)
                  : this.connected("client", node.id),
              active: this.running.filter((job) => job.backendId === node.id)
                .length,
              queued: this.jobs.filter((job) => job.backendId === node.id)
                .length,
              assigned: stats?.assigned ?? 0,
              completed: stats?.completed ?? 0,
              failed: stats?.failed ?? 0,
              rejected: stats?.rejected ?? 0,
            },
          ];
        }),
    );
  }
  hasRole(role: Role) {
    return components(this.config).some((node) => node.role === role);
  }
  connected(source: string, target: string) {
    return this.config.links.includes(`${source}-${target}`);
  }
  chooseBackend() {
    const ids = Object.keys(this.state.backends);
    if (!this.hasRole("client"))
      return { error: "Add a client to send requests" };
    const viaBalancer =
      this.hasRole("balancer") && this.connected("client", "balancer");
    if (viaBalancer && !this.config.balancer.online)
      return { error: "Load balancer unavailable" };
    const targets = ids.filter((id) =>
      this.connected(viaBalancer ? "balancer" : "client", id),
    );
    const healthy = targets.filter((id) => this.state.backends[id].online);
    if (!healthy.length)
      return {
        error: targets.length
          ? "No healthy backend targets"
          : "Connect the client or load balancer to a backend",
      };
    if (!viaBalancer) return { id: healthy[0], viaBalancer };
    let candidates = healthy;
    if (this.config.balancer.policy === "least-connections") {
      const least = Math.min(
        ...healthy.map(
          (id) =>
            this.state.backends[id].active + this.state.backends[id].queued,
        ),
      );
      candidates = healthy.filter(
        (id) =>
          this.state.backends[id].active + this.state.backends[id].queued ===
          least,
      );
    }
    return {
      id: candidates[this.roundRobin++ % candidates.length],
      viaBalancer,
    };
  }
  emit(
    job: Job,
    component: string,
    text: string,
    kind: Trace["kind"] = "info",
    edge?: string,
    reverse = false,
  ) {
    const event: Trace = {
      id: this.eventId++,
      request: job.rootId ?? job.id,
      time: this.state.now,
      component,
      text,
      kind,
      edge,
      reverse,
    };
    this.state.events.push(event);
    job.trace.push(event);
    this.state.events = this.state.events.slice(-500);
    this.edgeUntil = this.state.now + 220;
    this.state.edge = edge;
    this.state.reverse = reverse;
    if (edge)
      this.state.transit = [
        ...this.state.transit,
        {
          edge,
          reverse,
          request: job.rootId ?? job.id,
          until: this.state.now + 220,
        },
      ].slice(-80);
  }
  expire() {
    this.state.transit = this.state.transit.filter(
      (message) => message.until > this.state.now,
    );
    this.state.entries = this.state.entries.filter(
      (e) => e.expires > this.state.now,
    );
  }
  limit(value: number, min: number, max: number) {
    return Math.min(
      max,
      Math.max(min, Number.isFinite(value) ? Math.floor(value) : min),
    );
  }
  setTraffic(rate: number, path: string, running: boolean) {
    this.state.traffic = { rate: this.limit(rate, 1, 20), path, running };
    this.nextArrival = running ? this.state.now : Infinity;
  }
  send(path: string, count = 1) {
    for (let i = 0; i < this.limit(count, 1, 100); i++) {
      const job: Job = {
        id: this.nextId++,
        path,
        key: `user:${path.split("/").pop()}`,
        start: this.state.now,
        stage: 0,
        deadline: 0,
        due: 0,
        startedAt: this.state.now,
        trace: [],
      };
      this.state.metrics.sent++;
      job.viaBalancer =
        this.hasRole("balancer") && this.connected("client", "balancer");
      if (
        this.hasRole("balancer") &&
        this.connected("client", "balancer") &&
        this.config.balancer.online &&
        !this.gateway.allow(this.state.now)
      ) {
        this.emit(
          job,
          "balancer",
          "Token bucket empty · reject before backend",
          "error",
          "client-balancer",
        );
        this.record(
          job,
          429,
          { error: "API gateway rate limit exceeded" },
          "gateway",
        );
        this.state.metrics.rejected++;
        continue;
      }
      const target = this.chooseBackend();
      if (!target.id) {
        this.record(job, 503, { error: target.error }, "topology");
        continue;
      }
      job.backendId = target.id;
      job.backendName = this.state.backends[target.id].name;
      job.viaBalancer = target.viaBalancer;
      const backend = this.state.backends[target.id];
      backend.assigned++;
      if (job.viaBalancer)
        this.emit(
          job,
          "balancer",
          `${this.config.balancer.policy} selected ${job.backendName}`,
          "info",
          "client-balancer",
        );
      if (
        backend.active >= backend.concurrency &&
        backend.queued >= backend.queueLimit
      ) {
        this.record(
          job,
          429,
          { error: "Backend queue is full", backend: job.backendId },
          "overload",
        );
        this.state.metrics.rejected++;
        backend.rejected++;
        continue;
      }
      this.jobs.push(job);
      this.emit(job, "client", `GET ${path} queued`);
      this.startNext();
      this.state.peakQueue = Math.max(this.state.peakQueue, this.jobs.length);
    }
    this.state.queue = this.jobs.length;
  }
  startNext() {
    for (const job of [...this.jobs]) {
      const backend = this.state.backends[job.backendId!];
      if (!backend?.online || backend.active >= backend.concurrency) continue;
      this.jobs = this.jobs.filter((queued) => queued.id !== job.id);
      job.startedAt = this.state.now;
      job.deadline = job.parent
        ? Math.min(job.deadline, this.state.now + backend.timeout)
        : this.state.now + backend.timeout;
      job.due = this.state.now + 160;
      this.running.push(job);
      backend.active++;
      this.emit(
        job,
        job.parent?.backendId ?? "client",
        `GET ${job.path} sent`,
        "info",
        job.parent
          ? `${job.parent.backendId}-${job.backendId}`
          : job.viaBalancer
            ? `balancer-${job.backendId}`
            : `client-${job.backendId}`,
      );
    }
    for (const [id, backend] of Object.entries(this.state.backends))
      backend.queued = this.jobs.filter((job) => job.backendId === id).length;
    this.state.activeCount = this.running.length;
    this.state.active = this.running.length > 0;
    this.state.queue = this.jobs.length;
  }
  record(job: Job, status: number, body: unknown, source: string) {
    if (job.completed) return;
    job.completed = true;
    if (job.parent) {
      this.recordCall(job, status, body);
      return;
    }
    if (
      status >= 400 &&
      body &&
      typeof body === "object" &&
      "error" in body &&
      typeof body.error === "string"
    )
      this.emit(job, job.backendId ?? "client", body.error, "error");
    const duration = this.state.now - job.start;
    const wait = job.startedAt - job.start;
    const result: Result = {
      id: job.id,
      path: job.path,
      status,
      body,
      duration,
      wait,
      source,
      backendId: job.backendId,
      backendName: job.backendName,
      trace: job.trace,
    };
    this.state.results.unshift(result);
    this.state.results = this.state.results.slice(0, 100);
    if (job.backendId && this.state.backends[job.backendId]) {
      this.state.backends[job.backendId].completed++;
      this.state.backends[job.backendId].failed += Number(status >= 400);
    }
    this.state.metrics.completed++;
    this.state.metrics.failed += Number(status >= 400);
    this.state.metrics.totalDuration += duration;
    this.state.metrics.totalWait += wait;
    this.emit(
      job,
      "client",
      `${status} ${status === 200 ? "OK" : "Error"} · response received`,
      status >= 400 ? "error" : "info",
      job.viaBalancer
        ? "client-balancer"
        : `client-${job.backendId ?? "backend"}`,
      true,
    );
    this.onResult(result);
  }
  finish(status: number, body: unknown, source: string) {
    this.complete(this.current!, status, body, source);
    this.current = undefined;
    this.startNext();
  }
  complete(job: Job, status: number, body: unknown, source: string) {
    if (job.completed) return;
    const activeJobs = new Set(this.running);
    const descendants = [...this.running, ...this.jobs].filter((candidate) => {
      for (let parent = candidate.parent; parent; parent = parent.parent)
        if (parent === job) return true;
      return false;
    });
    for (const child of descendants) {
      child.completed = true;
      if (child.attemptDeadline !== undefined)
        this.circuits.cancel(child.backendId!, child.generation ?? 0);
      if (activeJobs.has(child) && this.state.backends[child.backendId!])
        this.state.backends[child.backendId!].active--;
      this.emit(
        child,
        child.backendId!,
        "Call cancelled because its caller finished",
        "error",
      );
    }
    const cancelled = new Set(descendants);
    this.running = this.running.filter(
      (active) => active !== job && !cancelled.has(active),
    );
    this.jobs = this.jobs.filter(
      (queued) => queued !== job && !cancelled.has(queued),
    );
    if (job.attemptDeadline !== undefined)
      this.circuits.cancel(job.backendId!, job.generation ?? 0);
    if (job.backendId && this.state.backends[job.backendId])
      this.state.backends[job.backendId].active = this.running.filter(
        (active) => active.backendId === job.backendId,
      ).length;
    this.record(job, status, body, source);
  }
  recordCall(job: Job, status: number, body: unknown) {
    const parent = job.parent!,
      id = job.backendId!;
    const backend = this.state.backends[id];
    if (backend) {
      backend.completed++;
      backend.failed += Number(status >= 400);
    }
    if (status >= 400 && body && typeof body === "object" && "error" in body)
      this.emit(job, id, String(body.error), "error");
    this.emit(
      job,
      id,
      `${status} ${status === 200 ? "OK" : "Error"} · return to ${parent.backendName}`,
      status >= 400 ? "error" : "info",
      `${parent.backendId}-${id}`,
      true,
    );
    if (parent.completed) return;
    parent.children = parent.children?.filter((child) => child !== job.id);
    if (status >= 400) {
      this.emit(
        parent,
        parent.backendId!,
        `Dependency ${job.backendName} failed with ${status}`,
        "error",
      );
      this.complete(
        parent,
        status,
        {
          error: `Dependency ${job.backendName} failed`,
          dependency: id,
          cause: body,
        },
        "service",
      );
      return;
    }
    (parent.responses ??= {})[id] = body;
    if (!parent.children?.length) this.dispatchCalls(parent);
  }
  dispatchCalls(job: Job) {
    const settings = serviceSettings(this.config, job.backendId!);
    const targets = job.targets ?? [];
    if (!targets.length) {
      this.serviceResponse(job);
      return;
    }
    const batch =
      settings.calls === "parallel" ? targets.splice(0) : targets.splice(0, 1);
    this.emit(
      job,
      job.backendId!,
      `Call ${batch.length} ${batch.length === 1 ? "dependency" : "dependencies"} · ${settings.calls}`,
    );
    for (const id of batch) {
      if (job.completed) break;
      const backend = this.state.backends[id];
      const ancestry: string[] = [];
      for (
        let ancestor: Job | undefined = job;
        ancestor;
        ancestor = ancestor.parent
      )
        ancestry.push(ancestor.backendId!);
      if (ancestry.includes(id) || ancestry.length >= 8) {
        this.complete(
          job,
          503,
          { error: "Service dependency cycle or depth limit reached" },
          "topology",
        );
        break;
      }
      const call: Job = {
        id: this.nextCallId--,
        rootId: job.rootId ?? job.id,
        parent: job,
        path: backendSettings(this.config, id).route.replace(
          ":id",
          job.path.split("/").pop()!,
        ),
        key: job.key,
        start: this.state.now,
        startedAt: this.state.now,
        stage: 0,
        deadline: Math.min(job.deadline, job.dependencyDeadline!),
        due: 0,
        backendId: id,
        backendName: backend?.name ?? id,
        trace: job.trace,
      };
      (job.children ??= []).push(call.id);
      this.emit(
        call,
        job.backendId!,
        `GET ${call.path} · call ${call.backendName}`,
        "info",
        `${job.backendId}-${id}`,
      );
      if (!backend?.online || !this.connected(job.backendId!, id)) {
        this.record(call, 503, { error: "Dependency unavailable" }, "service");
        break;
      }
      backend.assigned++;
      if (
        backend.active >= backend.concurrency &&
        backend.queued >= backend.queueLimit
      ) {
        backend.rejected++;
        this.record(
          call,
          429,
          { error: "Dependency queue is full" },
          "overload",
        );
        break;
      }
      this.jobs.push(call);
      this.startNext();
      this.state.peakQueue = Math.max(this.state.peakQueue, this.jobs.length);
    }
  }
  serviceResponse(job: Job) {
    job.dependencyDeadline = undefined;
    const settings = serviceSettings(this.config, job.backendId!);
    const body = {
      service: job.backendName,
      id: job.path.split("/").pop(),
      dependencies: job.responses ?? {},
    };
    if (settings.publish !== "none") {
      const target = settings.publish;
      if (!this.hasRole(target) || !this.connected(job.backendId!, target)) {
        this.complete(
          job,
          503,
          { error: `Connect this service to ${target} before publishing` },
          "messaging",
        );
        return;
      }
      const before =
        target === "queue"
          ? this.queueLab.state.published
          : this.kafka.state.produced;
      if (target === "queue")
        this.queueLab.publish(body, 1, this.state.now, job.backendId!, true);
      else
        this.kafka.produce(
          job.key,
          body,
          1,
          this.state.now,
          job.backendId!,
          true,
        );
      this.syncLabs();
      const after =
        target === "queue"
          ? this.queueLab.state.published
          : this.kafka.state.produced;
      this.emit(
        job,
        job.backendId!,
        after > before
          ? `Published fulfillment event to ${target}`
          : `Publish to ${target} failed`,
        after > before ? "info" : "error",
        `${job.backendId}-${target}`,
      );
      if (after === before) {
        this.complete(
          job,
          503,
          { error: `Publish to ${target} failed` },
          "messaging",
        );
        return;
      }
    }
    job.body = body;
    job.responseSource = "service";
    job.stage = 11;
    job.due = this.state.now + 160;
  }
  scheduleDatabase(job: Job) {
    const id = job.backendId!,
      settings = resilienceSettings(this.config, id),
      link = connectionSettings(this.config, `${id}-database`);
    const permit = this.circuits.before(id, settings, this.state.now);
    if (!permit.allowed) {
      this.emit(
        job,
        id,
        `Circuit ${this.circuits.get(id).state} · database call rejected`,
        "error",
      );
      this.finish(503, { error: "Database circuit is open" }, "circuit");
      return;
    }
    job.generation = permit.generation;
    job.attempt = (job.attempt ?? 0) + 1;
    job.attemptDeadline = this.state.now + settings.attemptTimeout;
    job.dependencyFault =
      link.failureEvery > 0 &&
      this.circuits.get(id).attempts % link.failureEvery === 0;
    this.emit(
      job,
      id,
      `Database attempt ${job.attempt}${this.circuits.get(id).state === "half-open" ? " · half-open probe" : ""}`,
    );
    job.stage = 3;
    job.due =
      this.state.now + this.database.delay(this.config.delay) + link.latency;
  }
  dependencyFailure(job: Job, status: number, reason: string) {
    const id = job.backendId!,
      settings = resilienceSettings(this.config, id);
    job.attemptDeadline = undefined;
    this.circuits.failure(id, settings, this.state.now, job.generation ?? 0);
    this.emit(
      job,
      id,
      `${reason} · attempt ${job.attempt}`,
      "error",
      `${id}-database`,
      true,
    );
    if (
      (job.attempt ?? 1) <= settings.maxRetries &&
      this.circuits.get(id).state !== "open"
    ) {
      const delay = retryDelay(settings, job.attempt ?? 1);
      if (this.state.now + delay < job.deadline) {
        this.circuits.get(id).retries++;
        this.emit(
          job,
          id,
          `Retry in ${delay} ms · ${settings.backoff} backoff`,
        );
        job.stage = 9;
        job.due = this.state.now + delay;
        return;
      }
    }
    this.finish(
      status,
      { error: reason, attempts: job.attempt },
      status === 504 ? "timeout" : "database",
    );
  }
  nextTime() {
    return Math.min(
      this.nextArrival,
      this.kafka.nextTime(),
      this.queueLab.nextTime(),
      this.database.nextTime(),
      ...this.running.map((job) =>
        Math.min(
          job.due,
          job.deadline,
          job.attemptDeadline ?? Infinity,
          job.dependencyDeadline ?? Infinity,
        ),
      ),
    );
  }
  step() {
    const next = this.nextTime();
    if (!Number.isFinite(next)) return;
    this.state.now = Math.max(this.state.now, next);
    this.expire();
    if (this.database.nextTime() <= next) {
      this.database.step(this.state.now);
      this.syncLabs();
      return;
    }
    if (this.kafka.nextTime() <= next) {
      this.kafka.step(this.state.now);
      this.syncLabs();
      return;
    }
    if (this.queueLab.nextTime() <= next) {
      this.queueLab.step(this.state.now);
      this.syncLabs();
      return;
    }
    const job = [...this.running].sort(
      (a, b) =>
        Math.min(
          a.due,
          a.deadline,
          a.attemptDeadline ?? Infinity,
          a.dependencyDeadline ?? Infinity,
        ) -
          Math.min(
            b.due,
            b.deadline,
            b.attemptDeadline ?? Infinity,
            b.dependencyDeadline ?? Infinity,
          ) || a.id - b.id,
    )[0];
    if (
      !job ||
      this.nextArrival <
        Math.min(
          job.due,
          job.deadline,
          job.attemptDeadline ?? Infinity,
          job.dependencyDeadline ?? Infinity,
        )
    ) {
      this.send(this.state.traffic.path);
      this.nextArrival += 1000 / this.state.traffic.rate;
      return;
    }
    this.current = job;
    const j = job;
    if (
      this.state.now >= j.deadline ||
      this.state.now >= (j.dependencyDeadline ?? Infinity)
    ) {
      if (j.attemptDeadline !== undefined)
        this.circuits.failure(
          j.backendId!,
          resilienceSettings(this.config, j.backendId!),
          this.state.now,
          j.generation ?? 0,
        );
      this.finish(504, { error: "Backend dependency timed out" }, "timeout");
      return;
    }
    const backend = this.state.backends[j.backendId!];
    const settings = backendSettings(this.config, j.backendId!);
    const connected = (role: string) => this.connected(j.backendId!, role);
    if (!backend?.online) {
      this.finish(
        503,
        { error: "Assigned backend unavailable", backend: j.backendId },
        "backend",
      );
      return;
    }
    if (
      j.viaBalancer &&
      (!this.hasRole("balancer") ||
        !this.config.balancer.online ||
        !this.connected("client", "balancer") ||
        !this.connected("balancer", j.backendId!))
    ) {
      this.finish(
        503,
        { error: "Load balancer response path unavailable" },
        "topology",
      );
      return;
    }
    if (
      j.attemptDeadline !== undefined &&
      this.state.now >= j.attemptDeadline
    ) {
      this.dependencyFailure(j, 504, "Database call timed out");
      return;
    }
    if (j.parent && !this.connected(j.parent.backendId!, j.backendId!)) {
      this.finish(
        503,
        { error: "Service response path unavailable" },
        "topology",
      );
      return;
    }
    if (j.stage === 11) {
      if (j.viaBalancer) {
        this.emit(
          j,
          "balancer",
          `Response from ${j.backendName}`,
          "info",
          `balancer-${j.backendId}`,
          true,
        );
        j.stage = 8;
        j.due = this.state.now + 80;
      } else this.finish(200, j.body, "service");
      return;
    }
    if (j.stage === 9) {
      this.scheduleDatabase(j);
      return;
    }
    if (j.stage === 0) {
      if (
        (!j.parent && !this.hasRole("client")) ||
        !this.connected(
          j.parent?.backendId ?? (j.viaBalancer ? "balancer" : "client"),
          j.backendId!,
        )
      ) {
        this.finish(
          503,
          { error: "Connect the client to a backend" },
          "topology",
        );
        return;
      }
      const prefix = settings.route.split(":")[0];
      if (
        !j.path.startsWith(prefix) ||
        !j.path.slice(prefix.length) ||
        j.path.slice(prefix.length).includes("/")
      ) {
        this.finish(404, { error: "No matching route" }, "router");
        return;
      }
      this.emit(j, j.backendId!, `Route matched: GET ${settings.route}`);
      j.stage = 1;
      j.due = this.state.now + 120 + settings.processingDelay;
    } else if (j.stage === 1) {
      if (serviceSettings(this.config, j.backendId!).mode === "handler") {
        j.stage = 10;
        j.due = Infinity;
        j.targets = components(this.config)
          .filter(
            (part) =>
              part.role === "backend" && this.connected(j.backendId!, part.id),
          )
          .map((part) => part.id);
        if (j.targets.length) {
          j.dependencyDeadline = Math.min(
            j.deadline,
            this.state.now +
              serviceSettings(this.config, j.backendId!).dependencyTimeout,
          );
          this.dispatchCalls(j);
        } else this.serviceResponse(j);
        this.startNext();
        return;
      }
      if (
        !this.hasRole("cache") ||
        !connected("cache") ||
        !this.config.cache.online
      ) {
        this.emit(j, j.backendId!, "Cache is disconnected. Read database.");
        this.scheduleDatabase(j);
        return;
      }
      this.emit(j, "cache", `Lookup ${j.key}`, "info", `${j.backendId}-cache`);
      j.stage = 2;
      j.due = this.state.now + 100;
    } else if (j.stage === 2) {
      if (
        !this.hasRole("cache") ||
        !connected("cache") ||
        !this.config.cache.online
      ) {
        this.emit(
          j,
          j.backendId!,
          "Cache disconnected during lookup. Read database.",
        );
        this.scheduleDatabase(j);
        return;
      }
      const entry = readCache(this.state, j.key, this.state.now);
      if (entry) {
        j.body = structuredClone(entry.value);

        this.emit(
          j,
          "cache",
          `HIT · ${j.key}`,
          "hit",
          `${j.backendId}-cache`,
          true,
        );
        j.stage = 5;
        j.due = this.state.now + 160;
      } else {
        this.emit(
          j,
          "cache",
          `MISS · ${j.key} is not stored`,
          "miss",
          `${j.backendId}-cache`,
          true,
        );
        this.scheduleDatabase(j);
      }
    } else if (j.stage === 3) {
      if (
        !this.hasRole("database") ||
        !connected("database") ||
        !this.config.online ||
        !connectionSettings(this.config, `${j.backendId}-database`).online ||
        j.dependencyFault
      ) {
        this.emit(
          j,
          "database",
          "Database unavailable",
          "error",
          `${j.backendId}-database`,
        );
        this.dependencyFailure(j, 503, "Database unavailable");
        return;
      }
      this.state.reads++;
      this.emit(
        j,
        "database",
        `Read users/${j.path.split("/").pop()}`,
        "info",
        `${j.backendId}-database`,
      );
      j.stage = 4;
      j.due =
        this.state.now +
        100 +
        connectionSettings(this.config, `${j.backendId}-database`).latency;
    } else if (j.stage === 4) {
      if (
        !this.hasRole("database") ||
        !connected("database") ||
        !this.config.online ||
        !connectionSettings(this.config, `${j.backendId}-database`).online ||
        j.dependencyFault
      ) {
        this.dependencyFailure(j, 503, "Database unavailable during read");
        return;
      }
      j.attemptDeadline = undefined;
      this.circuits.success(j.backendId!, j.generation ?? 0);
      const read = this.database.read(j.path.split("/").pop()!, this.state.now);
      this.emit(j, "database", this.database.state.reply);
      if (read.error) {
        this.finish(429, { error: read.error }, "database");
        return;
      }
      const value = read.value;
      if (!value) {
        this.finish(404, { error: "User not found" }, "database");
        return;
      }
      j.body = structuredClone(value);
      this.emit(
        j,
        "database",
        "Record found · return user",
        "info",
        `${j.backendId}-database`,
        true,
      );
      j.stage = 7;
      j.due = this.state.now + 120;
    } else if (j.stage === 7) {
      const value = j.body;
      if (
        this.hasRole("cache") &&
        connected("cache") &&
        this.config.cache.online
      ) {
        const result = writeCache(
          this.state,
          j.key,
          value,
          this.config.ttl * 1000,
          this.state.now,
          this.config.cache,
          this.config.capacity,
          this.config.eviction,
        );
        for (const key of result.evicted)
          this.emit(j, "cache", `Evicted ${key}`);
        this.emit(
          j,
          "cache",
          result.error ?? `Stored ${j.key} · expires in ${this.config.ttl}s`,
          result.error ? "error" : "info",
          `${j.backendId}-cache`,
        );
      }
      j.stage = 6;
      j.due = this.state.now + 160;
    } else {
      if (j.viaBalancer && j.stage !== 8) {
        this.emit(
          j,
          "balancer",
          `Response from ${j.backendName}`,
          "info",
          `balancer-${j.backendId}`,
          true,
        );
        j.responseSource = j.stage === 5 ? "cache" : "database";
        j.stage = 8;
        j.due = this.state.now + 80;
      } else if (j.stage === 8) {
        this.finish(200, j.body, j.responseSource!);
      } else this.finish(200, j.body, j.stage === 5 ? "cache" : "database");
    }
  }
  advance(ms: number) {
    const target = this.state.now + ms;
    while (this.nextTime() <= target) this.step();
    this.state.now = Math.max(target, this.state.now);
    this.expire();
    this.gateway.refill(this.state.now);
    this.syncLabs();
    if (!this.running.length && this.state.now >= this.edgeUntil) {
      this.state.edge = undefined;
      this.state.reverse = false;
    }
  }
}
