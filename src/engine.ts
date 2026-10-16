export type Role = "client" | "backend" | "cache" | "database" | "balancer";
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
export function components(config: Config): Component[] {
  return (
    config.components ??
    config.roles.map((role) => ({ id: role, role, name: role }))
  );
}
export function initialSnapshot(): Snapshot {
  return {
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
  now: number;
  events: Trace[];
  results: Result[];
  entries: {
    key: string;
    value: unknown;
    expires: number;
    used: number;
    created: number;
  }[];
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
  eventId = 1;
  edgeUntil = 0;
  roundRobin = 0;
  constructor() {
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
    this.refreshBackends();
    const removed = this.running.filter(
      (job) => !this.state.backends[job.backendId!],
    );
    this.running = this.running.filter(
      (job) => this.state.backends[job.backendId!],
    );
    for (const job of removed)
      this.record(job, 503, { error: "Assigned backend removed" }, "backend");
    const cancelled = this.jobs.filter(
      (job) => !this.state.backends[job.backendId!]?.online,
    );
    this.jobs = this.jobs.filter(
      (job) => this.state.backends[job.backendId!]?.online,
    );
    for (const job of cancelled) {
      job.startedAt = this.state.now;
      this.record(
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
      request: job.id,
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
        { edge, reverse, request: job.id, until: this.state.now + 220 },
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
      job.deadline = this.state.now + backend.timeout;
      job.due = this.state.now + 160;
      this.running.push(job);
      backend.active++;
      this.emit(
        job,
        "client",
        `GET ${job.path} sent`,
        "info",
        job.viaBalancer
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
    this.state.results.unshift({
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
    });
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
  }
  finish(status: number, body: unknown, source: string) {
    const job = this.current!;
    this.record(job, status, body, source);
    this.running = this.running.filter((active) => active.id !== job.id);
    if (job.backendId && this.state.backends[job.backendId])
      this.state.backends[job.backendId].active--;
    this.current = undefined;
    this.startNext();
  }
  nextTime() {
    return Math.min(
      this.nextArrival,
      ...this.running.map((job) => Math.min(job.due, job.deadline)),
    );
  }
  step() {
    const next = this.nextTime();
    if (!Number.isFinite(next)) return;
    this.state.now = Math.max(this.state.now, next);
    this.expire();
    const job = [...this.running].sort(
      (a, b) =>
        Math.min(a.due, a.deadline) - Math.min(b.due, b.deadline) ||
        a.id - b.id,
    )[0];
    if (!job || this.nextArrival < Math.min(job.due, job.deadline)) {
      this.send(this.state.traffic.path);
      this.nextArrival += 1000 / this.state.traffic.rate;
      return;
    }
    this.current = job;
    const j = job;
    if (this.state.now >= j.deadline) {
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
    if (j.stage === 0) {
      if (
        !this.hasRole("client") ||
        !this.connected(j.viaBalancer ? "balancer" : "client", j.backendId!)
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
      if (!this.hasRole("cache") || !connected("cache")) {
        this.emit(j, j.backendId!, "Cache is disconnected. Read database.");
        j.stage = 3;
        j.due = this.state.now + this.config.delay;
        return;
      }
      this.emit(j, "cache", `Lookup ${j.key}`, "info", `${j.backendId}-cache`);
      j.stage = 2;
      j.due = this.state.now + 100;
    } else if (j.stage === 2) {
      if (!this.hasRole("cache") || !connected("cache")) {
        this.emit(
          j,
          j.backendId!,
          "Cache disconnected during lookup. Read database.",
        );
        j.stage = 3;
        j.due = this.state.now + this.config.delay;
        return;
      }
      const entry = this.state.entries.find((e) => e.key === j.key);
      if (entry) {
        j.body = structuredClone(entry.value);
        this.state.hits++;
        entry.used = this.state.now;
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
        this.state.misses++;
        this.emit(
          j,
          "cache",
          `MISS · ${j.key} is not stored`,
          "miss",
          `${j.backendId}-cache`,
          true,
        );
        j.stage = 3;
        j.due = this.state.now + this.config.delay;
      }
    } else if (j.stage === 3) {
      if (
        !this.hasRole("database") ||
        !connected("database") ||
        !this.config.online
      ) {
        this.emit(
          j,
          "database",
          "Database unavailable",
          "error",
          `${j.backendId}-database`,
        );
        this.finish(503, { error: "Database unavailable" }, "database");
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
      j.due = this.state.now + 100;
    } else if (j.stage === 4) {
      if (
        !this.hasRole("database") ||
        !connected("database") ||
        !this.config.online
      ) {
        this.finish(
          503,
          { error: "Database unavailable during read" },
          "database",
        );
        return;
      }
      const value = this.config.records[j.path.split("/").pop()!];
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
      if (this.hasRole("cache") && connected("cache")) {
        this.state.entries = this.state.entries.filter(
          (entry) => entry.key !== j.key,
        );
        const evicted: string[] = [];
        while (this.state.entries.length >= this.config.capacity) {
          const order = this.config.eviction === "LRU" ? "used" : "created";
          this.state.entries.sort((a, b) => a[order] - b[order]);
          evicted.push(this.state.entries.shift()!.key);
        }
        if (evicted.length)
          this.emit(
            j,
            "cache",
            `Evicted ${evicted.length === 1 ? evicted[0] : `${evicted.length} entries`} · ${this.config.eviction}`,
          );
        this.state.entries.push({
          key: j.key,
          value,
          expires: this.state.now + this.config.ttl * 1000,
          used: this.state.now,
          created: this.state.now,
        });
        this.emit(
          j,
          "cache",
          `Stored ${j.key} · expires in ${this.config.ttl}s`,
          "info",
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
    if (!this.running.length && this.state.now >= this.edgeUntil) {
      this.state.edge = undefined;
      this.state.reverse = false;
    }
  }
}
