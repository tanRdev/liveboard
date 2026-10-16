export type Role = "client" | "backend" | "cache" | "database";
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
};
export const defaults: Config = {
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
export type Trace = {
  id: number;
  request: number;
  time: number;
  component: Role;
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
};
export class Engine {
  config: Config = structuredClone(defaults);
  state: Snapshot = {
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
  };
  jobs: Job[] = [];
  current?: Job;
  running: Job[] = [];
  nextArrival = Infinity;
  nextId = 1;
  eventId = 1;
  edgeUntil = 0;
  configure(config: Config) {
    this.config = { ...structuredClone(defaults), ...structuredClone(config) };
    this.config.concurrency = this.limit(this.config.concurrency, 1, 16);
    this.config.queueLimit = this.limit(this.config.queueLimit, 0, 500);
    this.startNext();
  }
  emit(
    job: Job,
    component: Role,
    text: string,
    kind: Trace["kind"] = "info",
    edge?: string,
    reverse = false,
  ) {
    this.state.events.push({
      id: this.eventId++,
      request: job.id,
      time: this.state.now,
      component,
      text,
      kind,
      edge,
      reverse,
    });
    this.state.events = this.state.events.slice(-500);
    this.edgeUntil = this.state.now + 220;
    this.state.edge = edge;
    this.state.reverse = reverse;
  }
  expire() {
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
      };
      this.state.metrics.sent++;
      if (
        this.running.length >= this.config.concurrency &&
        this.jobs.length >= this.config.queueLimit
      ) {
        this.record(job, 429, { error: "Backend queue is full" }, "overload");
        this.state.metrics.rejected++;
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
    while (this.jobs.length && this.running.length < this.config.concurrency) {
      const job = this.jobs.shift()!;
      job.startedAt = this.state.now;
      job.deadline = this.state.now + this.config.timeout;
      job.due = this.state.now + 160;
      this.running.push(job);
      this.emit(
        job,
        "client",
        `GET ${job.path} sent`,
        "info",
        "client-backend",
      );
    }
    this.state.activeCount = this.running.length;
    this.state.active = this.running.length > 0;
    this.state.queue = this.jobs.length;
  }
  record(job: Job, status: number, body: unknown, source: string) {
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
    });
    this.state.results = this.state.results.slice(0, 100);
    this.state.metrics.completed++;
    this.state.metrics.failed += Number(status >= 400);
    this.state.metrics.totalDuration += duration;
    this.state.metrics.totalWait += wait;
    this.emit(
      job,
      "client",
      `${status} ${status === 200 ? "OK" : "Error"} · response received`,
      status >= 400 ? "error" : "info",
      "client-backend",
      true,
    );
  }
  finish(status: number, body: unknown, source: string) {
    const job = this.current!;
    this.record(job, status, body, source);
    this.running = this.running.filter((active) => active.id !== job.id);
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
    const connected = (link: string) => this.config.links.includes(link);
    if (j.stage === 0) {
      if (
        !this.config.roles.includes("client") ||
        !this.config.roles.includes("backend") ||
        !connected("client-backend")
      ) {
        this.finish(
          503,
          { error: "Connect the client to a backend" },
          "topology",
        );
        return;
      }
      const prefix = this.config.route.split(":")[0];
      if (
        !j.path.startsWith(prefix) ||
        !j.path.slice(prefix.length) ||
        j.path.slice(prefix.length).includes("/")
      ) {
        this.finish(404, { error: "No matching route" }, "router");
        return;
      }
      this.emit(j, "backend", `Route matched: GET ${this.config.route}`);
      j.stage = 1;
      j.due = this.state.now + 120;
    } else if (j.stage === 1) {
      if (!this.config.roles.includes("cache") || !connected("backend-cache")) {
        this.emit(j, "backend", "Cache is disconnected. Read database.");
        j.stage = 3;
        j.due = this.state.now + this.config.delay;
        return;
      }
      this.emit(j, "cache", `Lookup ${j.key}`, "info", "backend-cache");
      j.stage = 2;
      j.due = this.state.now + 100;
    } else if (j.stage === 2) {
      const entry = this.state.entries.find((e) => e.key === j.key);
      if (entry) {
        j.body = structuredClone(entry.value);
        this.state.hits++;
        entry.used = this.state.now;
        this.emit(j, "cache", `HIT · ${j.key}`, "hit", "backend-cache", true);
        j.stage = 5;
        j.due = this.state.now + 160;
      } else {
        this.state.misses++;
        this.emit(
          j,
          "cache",
          `MISS · ${j.key} is not stored`,
          "miss",
          "backend-cache",
          true,
        );
        j.stage = 3;
        j.due = this.state.now + this.config.delay;
      }
    } else if (j.stage === 3) {
      if (
        !this.config.roles.includes("database") ||
        !connected("backend-database") ||
        !this.config.online
      ) {
        this.emit(
          j,
          "database",
          "Database unavailable",
          "error",
          "backend-database",
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
        "backend-database",
      );
      j.stage = 4;
      j.due = this.state.now + 100;
    } else if (j.stage === 4) {
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
        "backend-database",
        true,
      );
      j.stage = 7;
      j.due = this.state.now + 120;
    } else if (j.stage === 7) {
      const value = j.body;
      if (this.config.roles.includes("cache") && connected("backend-cache")) {
        this.state.entries = this.state.entries.filter(
          (entry) => entry.key !== j.key,
        );
        while (this.state.entries.length >= this.config.capacity) {
          const order = this.config.eviction === "LRU" ? "used" : "created";
          this.state.entries.sort((a, b) => a[order] - b[order]);
          const evicted = this.state.entries.shift()!;
          this.emit(
            j,
            "cache",
            `Evicted ${evicted.key} · ${this.config.eviction}`,
          );
        }
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
          "backend-cache",
        );
      }
      j.stage = 6;
      j.due = this.state.now + 160;
    } else {
      this.finish(200, j.body, j.stage === 5 ? "cache" : "database");
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
