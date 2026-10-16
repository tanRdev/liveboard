export type Role = "client" | "backend" | "cache" | "database";
export type Config = {
  ttl: number;
  capacity: number;
  eviction: "LRU" | "FIFO";
  timeout: number;
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
  source: string;
};
type Job = {
  id: number;
  path: string;
  start: number;
  key: string;
  stage: number;
  deadline: number;
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
  };
  jobs: Job[] = [];
  current?: Job;
  due = 0;
  nextId = 1;
  eventId = 1;
  edgeUntil = 0;
  configure(config: Config) {
    this.config = structuredClone(config);
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
  send(path: string, count = 1) {
    for (let i = 0; i < Math.min(count, 100); i++) {
      const job = {
        id: this.nextId++,
        path,
        key: `user:${path.split("/").pop()}`,
        start: this.state.now,
        stage: 0,
        deadline: 0,
      };
      this.jobs.push(job);
      this.emit(job, "client", `GET ${path} queued`);
    }
    this.startNext();
    this.state.queue = this.jobs.length;
  }
  startNext() {
    if (this.current || !this.jobs.length) return;
    this.current = this.jobs.shift()!;
    this.current.deadline = this.state.now + this.config.timeout;
    this.state.active = true;
    this.due = this.state.now + 160;
    this.state.queue = this.jobs.length;
    this.emit(
      this.current,
      "client",
      `GET ${this.current.path} sent`,
      "info",
      "client-backend",
    );
  }
  finish(status: number, body: unknown, source: string) {
    const job = this.current!;
    this.state.results.unshift({
      id: job.id,
      path: job.path,
      status,
      body,
      duration: this.state.now - job.start,
      source,
    });
    this.state.results = this.state.results.slice(0, 100);
    this.emit(
      job,
      "client",
      `${status} ${status === 200 ? "OK" : "Error"} · response received`,
      status >= 400 ? "error" : "info",
      "client-backend",
      true,
    );
    this.current = undefined;
    this.state.active = false;
    this.startNext();
  }
  step() {
    if (!this.current) return;
    this.state.now = Math.max(
      this.state.now,
      Math.min(this.due, this.current.deadline),
    );
    this.expire();
    const j = this.current;
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
      this.due = this.state.now + 120;
    } else if (j.stage === 1) {
      if (!this.config.roles.includes("cache") || !connected("backend-cache")) {
        this.emit(j, "backend", "Cache is disconnected. Read database.");
        j.stage = 3;
        this.due = this.state.now + this.config.delay;
        return;
      }
      this.emit(j, "cache", `Lookup ${j.key}`, "info", "backend-cache");
      j.stage = 2;
      this.due = this.state.now + 100;
    } else if (j.stage === 2) {
      const entry = this.state.entries.find((e) => e.key === j.key);
      if (entry) {
        j.body = structuredClone(entry.value);
        this.state.hits++;
        entry.used = this.state.now;
        this.emit(j, "cache", `HIT · ${j.key}`, "hit", "backend-cache", true);
        j.stage = 5;
        this.due = this.state.now + 160;
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
        this.due = this.state.now + this.config.delay;
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
      this.due = this.state.now + 100;
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
      this.due = this.state.now + 120;
    } else if (j.stage === 7) {
      const value = j.body;
      if (this.config.roles.includes("cache") && connected("backend-cache")) {
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
      this.due = this.state.now + 160;
    } else {
      this.finish(200, j.body, j.stage === 5 ? "cache" : "database");
    }
  }
  advance(ms: number) {
    const target = this.state.now + ms;
    while (this.current && Math.min(this.due, this.current.deadline) <= target)
      this.step();
    this.state.now = Math.max(target, this.state.now);
    this.expire();
    if (!this.current && this.state.now >= this.edgeUntil) {
      this.state.edge = undefined;
      this.state.reverse = false;
    }
  }
}
