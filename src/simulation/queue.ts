export type QueueConfig = {
  technology: "rabbitmq" | "sqs";
  online: boolean;
  visibilityMs: number;
  maxDeliveries: number;
  capacity: number;
};
export type WorkerConfig = {
  online: boolean;
  prefetch: number;
  processingMs: number;
  ack: "automatic" | "manual";
  fail: boolean;
};
export const queueDefaults: QueueConfig = {
  technology: "rabbitmq",
  online: true,
  visibilityMs: 3000,
  maxDeliveries: 3,
  capacity: 200,
};
export const workerDefaults: WorkerConfig = {
  online: true,
  prefetch: 1,
  processingMs: 1000,
  ack: "automatic",
  fail: false,
};
export type QueueMessage = {
  id: number;
  value: unknown;
  deliveries: number;
  state: "ready" | "inflight" | "unacked" | "dead";
  worker?: string;
  due: number;
  visibleAt: number;
  receipt: number;
};
export type QueueEvent = {
  id: number;
  time: number;
  text: string;
  edge?: string;
  error?: boolean;
  reverse?: boolean;
};
export type QueueSnapshot = {
  inProgress: { id: number; receipt: number; worker: string; due: number }[];
  messages: QueueMessage[];
  events: QueueEvent[];
  published: number;
  acked: number;
  redelivered: number;
  processed: number;
  duplicates: number;
  rejected: number;
  reply: string;
};
export const emptyQueue = (): QueueSnapshot => ({
  messages: [],
  inProgress: [],
  events: [],
  published: 0,
  acked: 0,
  redelivered: 0,
  processed: 0,
  duplicates: 0,
  rejected: 0,
  reply: "",
});
export class QueueLab {
  state = emptyQueue();
  jobs: { id: number; receipt: number; worker: string; due: number }[] = [];
  seen = new Set<number>();
  config = { ...queueDefaults };
  workers: (WorkerConfig & { id: string })[] = [];
  enabled = false;
  connected = false;
  nextId = 1;
  eventId = 1;
  receipt = 1;
  now = 0;
  constructor(private onEvent: (event: QueueEvent) => void = () => {}) {}
  emit(text: string, edge?: string, error = false, reverse = false) {
    const event = {
      id: this.eventId++,
      time: this.now,
      text,
      edge,
      error,
      reverse,
    };
    this.state.events.push(event);
    this.state.events = this.state.events.slice(-150);
    this.state.reply = text;
    this.onEvent(event);
  }
  configure(
    config: QueueConfig,
    workers: (WorkerConfig & { id: string })[],
    enabled: boolean,
    connected: boolean,
    now: number,
  ) {
    this.now = now;
    if (
      (!enabled && this.enabled) ||
      config.technology !== this.config.technology
    ) {
      this.state = emptyQueue();
      this.jobs = [];
      this.seen.clear();
    }
    this.enabled = enabled;
    this.config = config;
    this.connected = connected;
    this.workers = workers;
    this.jobs = this.jobs.filter((job) =>
      workers.some((w) => w.id === job.worker && w.online),
    );
    for (const message of this.state.messages) {
      if (
        ["inflight", "unacked"].includes(message.state) &&
        !workers.some((w) => w.id === message.worker && w.online)
      ) {
        if (config.technology === "rabbitmq") {
          message.state = "ready";
          message.worker = undefined;
          this.emit(`Connection closed · requeued message ${message.id}`);
        } else {
          message.state = "unacked";
          message.due = Infinity;
        }
      }
    }
    this.pump();
  }
  publish(
    value: unknown,
    count: number,
    now: number,
    source = "producer",
    connected = this.connected,
  ) {
    this.now = now;
    for (let i = 0; i < Math.min(100, Math.max(1, count)); i++) {
      if (!this.enabled || !connected || !this.config.online) {
        this.state.rejected++;
        this.emit(
          "Publish failed · connect producer to an online queue",
          undefined,
          true,
        );
        continue;
      }
      if (
        this.state.messages.filter((m) => m.state !== "dead").length >=
          this.config.capacity ||
        this.state.messages.length >= 1000
      ) {
        this.state.rejected++;
        this.emit("Queue lab capacity reached", undefined, true);
        continue;
      }
      const message: QueueMessage = {
        id: this.nextId++,
        value: structuredClone(value),
        deliveries: 0,
        state: "ready",
        due: Infinity,
        visibleAt: Infinity,
        receipt: 0,
      };
      this.state.messages.push(message);
      this.state.published++;
      this.emit(`Published message ${message.id}`, `${source}-queue`);
    }
    this.pump();
  }
  pump() {
    this.state.inProgress = this.jobs.map((job) => ({ ...job }));
    if (!this.enabled || !this.config.online) return;
    for (const worker of this.workers.filter((w) => w.online)) {
      let slots =
        worker.prefetch -
        this.jobs.filter((job) => job.worker === worker.id).length -
        this.state.messages.filter(
          (m) => m.worker === worker.id && m.state === "unacked",
        ).length;
      for (const message of this.state.messages) {
        if (slots <= 0) break;
        if (message.state !== "ready") continue;
        if (message.deliveries >= this.config.maxDeliveries) {
          message.state = "dead";
          this.emit(
            `Message ${message.id} moved to dead-letter queue after ${message.deliveries} deliveries`,
            undefined,
            true,
          );
          continue;
        }
        message.state = "inflight";
        message.worker = worker.id;
        message.deliveries++;
        message.receipt = this.receipt++;
        message.due = this.now + worker.processingMs;
        message.visibleAt =
          this.config.technology === "sqs"
            ? this.now + this.config.visibilityMs
            : Infinity;
        this.jobs.push({
          id: message.id,
          receipt: message.receipt,
          worker: worker.id,
          due: message.due,
        });
        slots--;
        if (message.deliveries > 1) this.state.redelivered++;
        this.emit(
          `Deliver ${message.id} · attempt ${message.deliveries} · receipt ${message.receipt}`,
          `queue-${worker.id}`,
        );
      }
    }
    this.state.inProgress = this.jobs.map((job) => ({ ...job }));
  }
  nextTime() {
    return this.enabled && this.config.online
      ? Math.min(
          ...this.jobs.map((job) => job.due),
          ...this.state.messages
            .filter((m) => ["inflight", "unacked"].includes(m.state))
            .map((m) => m.visibleAt),
        )
      : Infinity;
  }
  step(now: number) {
    this.now = now;
    for (const message of this.state.messages)
      if (
        ["inflight", "unacked"].includes(message.state) &&
        message.visibleAt <= now
      ) {
        message.state = "ready";
        message.worker = undefined;
        message.due = Infinity;
        message.visibleAt = Infinity;
        this.emit(
          `Visibility expired · message ${message.id} can be delivered again`,
        );
      }
    const finished = this.jobs.filter((job) => job.due <= now);
    this.jobs = this.jobs.filter((job) => job.due > now);
    for (const job of finished) {
      const message = this.state.messages.find((m) => m.id === job.id);
      const worker = this.workers.find((w) => w.id === job.worker);
      if (!worker?.online) continue;
      const current =
        message &&
        message.receipt === job.receipt &&
        message.state === "inflight";
      if (worker.fail) {
        if (current) {
          message.due = Infinity;
          message.state =
            this.config.technology === "rabbitmq" ? "ready" : "unacked";
        }
        this.emit(
          `Worker failed message ${job.id}${this.config.technology === "rabbitmq" ? " · nack/requeue" : ""}`,
          undefined,
          true,
        );
        continue;
      }
      const duplicate = this.seen.has(job.id);
      this.seen.add(job.id);
      this.state.processed++;
      this.state.duplicates += Number(duplicate);
      this.emit(
        `${duplicate ? "DUPLICATE side effect · " : ""}Processed message ${job.id} · receipt ${job.receipt}`,
        `queue-${job.worker}`,
      );
      if (!current) {
        this.emit(
          `Receipt ${job.receipt} expired · cannot acknowledge message ${job.id}`,
          undefined,
          true,
        );
        continue;
      }
      message.due = Infinity;
      if (worker.ack === "automatic") this.ack(message.id, job.receipt);
      else {
        message.state = "unacked";
        this.emit(
          `Waiting for ${this.config.technology === "sqs" ? "DeleteMessage" : "ack"} · message ${message.id}`,
        );
      }
    }
    this.pump();
    const retained = new Set([
      ...this.state.messages.map((m) => m.id),
      ...this.jobs.map((job) => job.id),
    ]);
    this.seen = new Set([...this.seen].filter((id) => retained.has(id)));
  }
  ack(id: number, receipt?: number) {
    const message = this.state.messages.find((m) => m.id === id);
    if (
      !this.config.online ||
      !message ||
      !["inflight", "unacked"].includes(message.state) ||
      (receipt !== undefined && receipt !== message.receipt)
    )
      return;
    this.state.messages = this.state.messages.filter((m) => m !== message);
    this.state.acked++;
    this.emit(
      `${this.config.technology === "sqs" ? "Deleted" : "Acknowledged"} message ${id}`,
      message.worker ? `queue-${message.worker}` : undefined,
      false,
      true,
    );
    this.pump();
  }
  ackAll(now: number) {
    this.now = now;
    for (const message of [...this.state.messages])
      if (message.state === "unacked") this.ack(message.id, message.receipt);
  }
  redrive(now: number) {
    this.now = now;
    for (const message of this.state.messages)
      if (message.state === "dead") {
        message.state = "ready";
        message.deliveries = 0;
      }
    this.emit("Redrive dead-letter messages");
    this.pump();
  }
}
