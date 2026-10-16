export type KafkaConfig = {
  topic: string;
  partitions: number;
  replicationFactor: number;
  minISR: number;
  inSyncReplicas: number;
  retentionMs: number;
  segmentMs: number;
  online: boolean;
  assignor: "range" | "round-robin";
};
export type ProducerConfig = {
  acks: "all" | "1";
  partitioner: "key-hash" | "round-robin";
  key: string;
  payload: string;
};
export type ConsumerConfig = {
  groupId: string;
  online: boolean;
  autoCommit: boolean;
  commitInterval: number;
  offsetReset: "earliest" | "latest";
  processingMs: number;
};
export const kafkaDefaults: KafkaConfig = {
  topic: "orders",
  partitions: 3,
  replicationFactor: 3,
  minISR: 2,
  inSyncReplicas: 3,
  retentionMs: 60000,
  segmentMs: 1000,
  online: true,
  assignor: "range",
};
export const producerDefaults: ProducerConfig = {
  acks: "all",
  partitioner: "key-hash",
  key: "customer-1",
  payload: '{"orderId":"order-1","amount":49.99}',
};
export const consumerDefaults: ConsumerConfig = {
  groupId: "notifications",
  online: true,
  autoCommit: true,
  commitInterval: 1000,
  offsetReset: "earliest",
  processingMs: 500,
};
export type StreamRecord = {
  id: number;
  partition: number;
  offset: number;
  key: string;
  value: unknown;
  time: number;
  segment: number;
};
export type KafkaEvent = {
  id: number;
  time: number;
  component: string;
  text: string;
  recordId?: number;
  groupId?: string;
  edge?: string;
  error?: boolean;
  reverse?: boolean;
};
export type KafkaGroup = {
  id: string;
  members: string[];
  owners: string[];
  positions: number[];
  committed: number[];
  generation: number;
  nextCommit: number;
};
export type KafkaSnapshot = {
  partitions: {
    id: number;
    start: number;
    end: number;
    records: StreamRecord[];
  }[];
  groups: KafkaGroup[];
  events: KafkaEvent[];
  deliveries: {
    record: StreamRecord;
    consumer: string;
    groupId: string;
    duplicate: boolean;
    time: number;
  }[];
  produced: number;
  rejected: number;
  processed: number;
  duplicates: number;
  reply: string;
  active: number;
};
export function emptyKafka(): KafkaSnapshot {
  return {
    partitions: [],
    groups: [],
    events: [],
    deliveries: [],
    produced: 0,
    rejected: 0,
    processed: 0,
    duplicates: 0,
    reply: "",
    active: 0,
  };
}
type Consumer = ConsumerConfig & { id: string };
type Work = {
  record: StreamRecord;
  consumer: string;
  groupId: string;
  generation: number;
  due: number;
};
export class KafkaLab {
  state = emptyKafka();
  config = { ...kafkaDefaults };
  producer = { ...producerDefaults };
  consumers: Consumer[] = [];
  enabled = false;
  producerConnected = false;
  jobs: Work[] = [];
  groups = new Map<string, KafkaGroup>();
  seen = new Set<string>();
  nextCleanup = Infinity;
  nextId = 1;
  eventId = 1;
  roundRobin = 0;
  now = 0;
  constructor(private onEvent: (event: KafkaEvent) => void = () => {}) {}
  emit(
    component: string,
    text: string,
    record?: StreamRecord,
    groupId?: string,
    edge?: string,
    error = false,
    reverse = false,
  ) {
    const event = {
      id: this.eventId++,
      time: this.now,
      component,
      text,
      recordId: record?.id,
      groupId,
      edge,
      error,
      reverse,
    };
    this.state.events.push(event);
    this.state.events = this.state.events.slice(-200);
    this.onEvent(event);
  }
  configure(
    config: KafkaConfig,
    producer: ProducerConfig,
    consumers: Consumer[],
    enabled: boolean,
    producerConnected: boolean,
    now: number,
  ) {
    this.now = now;
    this.producer = producer;
    this.producerConnected = producerConnected;
    if (!enabled) {
      if (this.enabled) {
        this.state = emptyKafka();
        this.groups.clear();
        this.jobs = [];
        this.seen.clear();
      }
      this.enabled = false;
      this.consumers = [];
      this.nextCleanup = Infinity;
      return;
    }
    this.enabled = true;
    const count = this.state.partitions.length;
    if (count && config.partitions < count) {
      this.emit(
        "stream",
        "Kafka partitions cannot decrease. Reset the scenario to recreate the topic.",
        undefined,
        undefined,
        undefined,
        true,
      );
      config = { ...config, partitions: count };
    }
    if (this.config.topic !== config.topic && this.state.produced) {
      this.emit(
        "stream",
        "Reset the scenario before replacing a topic with retained records.",
        undefined,
        undefined,
        undefined,
        true,
      );
      config = { ...config, topic: this.config.topic };
    }
    const wasOnline = this.config.online;
    this.config = { ...config };
    this.consumers = consumers;
    if (!wasOnline && config.online)
      for (const job of this.jobs) job.due = Math.max(now, job.due);
    while (this.state.partitions.length < config.partitions) {
      const id = this.state.partitions.length;
      this.state.partitions.push({ id, start: 0, end: 0, records: [] });
    }
    const resetByGroup = new Map(
      consumers.map((c) => [c.groupId, c.offsetReset]),
    );
    for (const [groupId, reset] of resetByGroup) {
      if (!this.groups.has(groupId)) {
        if (this.groups.size >= 32) {
          this.emit(
            "stream",
            "Lab group limit reached. Reset execution to clear group history.",
            undefined,
            groupId,
            undefined,
            true,
          );
          continue;
        }
        const starts = this.state.partitions.map((p) =>
          reset === "earliest" ? p.start : p.end,
        );
        this.groups.set(groupId, {
          id: groupId,
          members: [],
          owners: [],
          positions: starts,
          committed: this.state.partitions.map(() => -1),
          generation: 0,
          nextCommit: now + 1000,
        });
      }
    }
    for (const group of this.groups.values()) {
      const members = consumers
        .filter((c) => c.groupId === group.id && c.online)
        .map((c) => c.id)
        .sort();
      const owners = this.state.partitions.map((_, index) => {
        if (!members.length) return "";
        if (config.assignor === "round-robin")
          return members[index % members.length];
        const base = Math.floor(config.partitions / members.length),
          extra = config.partitions % members.length;
        let end = 0;
        for (let i = 0; i < members.length; i++) {
          end += base + Number(i < extra);
          if (index < end) return members[i];
        }
        return members.at(-1)!;
      });
      if (
        owners.join("|") !== group.owners.join("|") ||
        members.join("|") !== group.members.join("|")
      ) {
        group.generation++;
        this.jobs = this.jobs.filter((work) => work.groupId !== group.id);
        group.positions = this.state.partitions.map((p, index) =>
          group.committed[index] >= 0
            ? group.committed[index]
            : consumers.find((c) => c.id === owners[index])?.offsetReset ===
                "latest"
              ? p.end
              : p.start,
        );
        group.committed = this.state.partitions.map(
          (_, index) => group.committed[index] ?? -1,
        );
        group.members = members;
        group.owners = owners;
        group.nextCommit = now + this.interval(group);
        this.emit(
          "stream",
          `Rebalance ${group.id} · generation ${group.generation} · ${members.length} members`,
          undefined,
          group.id,
        );
      }
    }
    this.scheduleRetention();
    this.pump();
    this.sync();
  }
  interval(group: KafkaGroup) {
    return Math.min(
      ...this.consumers
        .filter((c) => c.groupId === group.id && c.online && c.autoCommit)
        .map((c) => c.commitInterval),
      1000 * 60,
    );
  }
  sync() {
    this.state.groups = [...this.groups.values()];
    this.state.active = this.jobs.length;
  }
  produce(
    key: string,
    value: unknown,
    count: number,
    now: number,
    source = "producer",
    connected = this.producerConnected,
  ) {
    this.now = now;
    for (let i = 0; i < Math.min(100, Math.max(1, count)); i++) {
      if (
        !this.enabled ||
        !connected ||
        !this.config.online ||
        this.config.inSyncReplicas < 1
      ) {
        this.reject("No reachable Kafka leader");
        continue;
      }
      if (
        this.producer.acks === "all" &&
        this.config.inSyncReplicas < this.config.minISR
      ) {
        this.reject("NOT_ENOUGH_REPLICAS · ISR is below min.insync.replicas");
        continue;
      }
      if (
        this.state.partitions.reduce((sum, p) => sum + p.records.length, 0) >=
        2000
      ) {
        this.reject(
          "Lab record limit reached. Let retention clear records or reset execution.",
        );
        continue;
      }
      let hash = 0;
      for (const byte of new TextEncoder().encode(key))
        hash = (Math.imul(hash, 31) + byte) >>> 0;
      const partition =
        this.producer.partitioner === "key-hash" && key
          ? hash % this.state.partitions.length
          : this.roundRobin++ % this.state.partitions.length;
      const log = this.state.partitions[partition];
      const record = {
        id: this.nextId++,
        partition,
        offset: log.end++,
        key,
        value: structuredClone(value),
        time: now,
        segment:
          Math.floor(now / this.config.segmentMs) * this.config.segmentMs,
      };
      log.records.push(record);
      this.state.produced++;
      this.state.reply = `Acknowledged ${this.config.topic} · partition ${partition} · offset ${record.offset}`;
      this.emit(
        source,
        `Produce ${key || "(no key)"} → p${partition} @ ${record.offset}`,
        record,
        undefined,
        `${source}-stream`,
      );
      this.emit(
        "stream",
        `acks=${this.producer.acks} · ${this.config.inSyncReplicas} in-sync replicas`,
        record,
        undefined,
        `${source}-stream`,
        false,
        true,
      );
      this.scheduleRetention();
    }
    this.pump();
    this.sync();
  }
  scheduleRetention() {
    const deadlines: number[] = [];
    for (const partition of this.state.partitions) {
      const segments = new Map<number, number>();
      for (const record of partition.records)
        segments.set(
          record.segment,
          Math.max(segments.get(record.segment) ?? 0, record.time),
        );
      for (const [segment, newest] of segments)
        deadlines.push(
          Math.max(
            segment + this.config.segmentMs,
            newest + this.config.retentionMs,
          ),
        );
    }
    this.nextCleanup = Math.min(...deadlines);
  }
  reject(reason: string) {
    this.state.rejected++;
    this.state.reply = reason;
    this.emit(
      "producer",
      reason,
      undefined,
      undefined,
      "producer-stream",
      true,
    );
  }
  pump() {
    if (!this.enabled || !this.config.online) return;
    for (const group of this.groups.values())
      for (const consumerId of group.members) {
        if (this.jobs.some((work) => work.consumer === consumerId)) continue;
        const consumer = this.consumers.find((c) => c.id === consumerId);
        if (!consumer?.online) continue;
        const candidates = this.state.partitions
          .filter((p) => group.owners[p.id] === consumerId)
          .map((p) => {
            if (group.positions[p.id] < p.start) {
              group.positions[p.id] =
                consumer.offsetReset === "earliest" ? p.start : p.end;
              this.emit(
                consumerId,
                `Offset out of range · reset ${consumer.offsetReset} to ${group.positions[p.id]}`,
                undefined,
                group.id,
              );
            }
            return p.records.find(
              (record) => record.offset >= group.positions[p.id],
            );
          })
          .filter((record): record is StreamRecord => !!record)
          .sort((a, b) => a.time - b.time || a.id - b.id);
        const record = candidates[0];
        if (!record) continue;
        this.jobs.push({
          record,
          consumer: consumerId,
          groupId: group.id,
          generation: group.generation,
          due: this.now + consumer.processingMs,
        });
        this.emit(
          consumerId,
          `Fetch p${record.partition} @ ${record.offset}`,
          record,
          group.id,
          `stream-${consumerId}`,
        );
      }
    this.sync();
  }
  autoNeeded(group: KafkaGroup) {
    return group.positions.some(
      (position, p) =>
        position > Math.max(0, group.committed[p]) &&
        this.consumers.find((c) => c.id === group.owners[p])?.autoCommit,
    );
  }
  nextTime() {
    if (!this.enabled) return Infinity;
    return Math.min(
      ...this.jobs.map((job) =>
        this.config.online ? Math.max(this.now, job.due) : Infinity,
      ),
      this.config.online ? this.nextCleanup : Infinity,
      ...[...this.groups.values()]
        .filter((group) => this.config.online && this.autoNeeded(group))
        .map((group) => Math.max(this.now, group.nextCommit)),
    );
  }
  step(now: number) {
    this.now = now;
    if (this.config.online && this.nextCleanup <= now) {
      for (const partition of this.state.partitions) {
        const before = partition.records.length;
        const segments = new Map<number, number>();
        for (const record of partition.records)
          segments.set(
            record.segment,
            Math.max(segments.get(record.segment) ?? 0, record.time),
          );
        partition.records = partition.records.filter(
          (record) =>
            now < record.segment + this.config.segmentMs ||
            now - (segments.get(record.segment) ?? 0) < this.config.retentionMs,
        );
        partition.start = partition.records[0]?.offset ?? partition.end;
        if (before !== partition.records.length)
          this.emit(
            "stream",
            `Retention removed ${before - partition.records.length} records from p${partition.id}`,
          );
      }
      const retained = new Set(
        this.state.partitions.flatMap((p) =>
          p.records.map((record) => String(record.id)),
        ),
      );
      this.seen = new Set(
        [...this.seen].filter((key) => retained.has(key.split(":").at(-1)!)),
      );
      this.scheduleRetention();
      this.pump();
      return;
    }
    const group = [...this.groups.values()].find(
      (group) =>
        this.config.online && this.autoNeeded(group) && group.nextCommit <= now,
    );
    if (group) {
      this.commit(group.id, true);
      return;
    }
    const job = this.jobs
      .filter((job) => job.due <= now)
      .sort((a, b) => a.due - b.due || a.record.id - b.record.id)[0];
    if (!job) return;
    this.jobs = this.jobs.filter((work) => work !== job);
    const owner = this.groups.get(job.groupId);
    if (
      owner &&
      owner.generation === job.generation &&
      owner.owners[job.record.partition] === job.consumer
    ) {
      const seenKey = `${job.groupId}:${job.record.id}`;
      const duplicate = this.seen.has(seenKey);
      this.seen.add(seenKey);
      owner.positions[job.record.partition] = job.record.offset + 1;
      this.state.processed++;
      this.state.duplicates += Number(duplicate);
      this.state.deliveries.unshift({
        record: job.record,
        consumer: job.consumer,
        groupId: job.groupId,
        duplicate,
        time: now,
      });
      this.state.deliveries = this.state.deliveries.slice(0, 100);
      this.emit(
        job.consumer,
        `${duplicate ? "REPLAY · " : ""}Processed p${job.record.partition} @ ${job.record.offset}`,
        job.record,
        job.groupId,
        `stream-${job.consumer}`,
      );
      if (owner.nextCommit < now) owner.nextCommit = now + this.interval(owner);
    }
    this.pump();
    this.sync();
  }
  commit(groupId: string, automatic = false) {
    const group = this.groups.get(groupId);
    if (!group) return;
    if (!this.config.online) {
      this.emit(
        "stream",
        "Offset commit failed · Kafka offline",
        undefined,
        groupId,
        undefined,
        true,
      );
      return;
    }
    for (let p = 0; p < group.positions.length; p++)
      if (
        !automatic ||
        this.consumers.find((c) => c.id === group.owners[p])?.autoCommit
      )
        group.committed[p] = group.positions[p];
    group.nextCommit = this.now + this.interval(group);
    this.emit(
      "stream",
      `${automatic ? "Auto-commit" : "Commit"} ${groupId} · [${group.committed.join(", ")}]`,
      undefined,
      groupId,
    );
    this.sync();
  }
  replay(groupId: string, now: number) {
    const group = this.groups.get(groupId);
    if (!group) return;
    this.now = now;
    group.generation++;
    this.jobs = this.jobs.filter((job) => job.groupId !== groupId);
    group.positions = this.state.partitions.map((p) => p.start);
    group.nextCommit = now + this.interval(group);
    this.emit(
      "stream",
      `Seek ${groupId} to earliest · committed offsets unchanged`,
      undefined,
      groupId,
    );
    this.pump();
  }
}
