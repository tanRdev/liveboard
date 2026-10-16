import { technologyReference } from "./settings";
import type { Dispatch, SetStateAction, ReactNode } from "react";
import {
  consumerSettings,
  workerSettings,
  type Config,
  type Role,
  type Snapshot,
} from "./engine";
export function Option({
  label,
  value,
  choices,
  onChange,
  disabled = false,
}: {
  label: string;
  value: string;
  choices: readonly (readonly [string, string])[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <label className="lab-field">
      <span>{label}</span>
      <select
        className="field"
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        {choices.map(([key, text]) => (
          <option value={key} key={key}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}
export function Numeric({
  label,
  value,
  min = 1,
  max = 60000,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="lab-field">
      <span>{label}</span>
      <input
        className="field"
        aria-label={label}
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => {
          const v = e.currentTarget.valueAsNumber;
          if (Number.isFinite(v))
            onChange(Math.max(min, Math.min(max, Math.floor(v))));
        }}
      />
    </label>
  );
}
function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="lab-toggle">
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}
function Text({
  label,
  value,
  onChange,
  large = false,
  deferred = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  large?: boolean;
  deferred?: boolean;
}) {
  return (
    <label className="lab-field">
      <span>{label}</span>
      {large ? (
        <textarea
          className="field"
          aria-label={label}
          maxLength={4096}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : deferred ? (
        <input
          key={value}
          className="field"
          aria-label={label}
          maxLength={128}
          defaultValue={value}
          onBlur={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
        />
      ) : (
        <input
          className="field"
          aria-label={label}
          maxLength={128}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </label>
  );
}
function Note({ children }: { children: ReactNode }) {
  return <p className="field-help">{children}</p>;
}
type Props = {
  role: Role;
  id: string;
  config: Config;
  state: Snapshot;
  onConfig: Dispatch<SetStateAction<Config>>;
};
function settingsUpdater(onConfig: Props["onConfig"]) {
  return <
    K extends
      | "cache"
      | "kafka"
      | "producer"
      | "queueSettings"
      | "database"
      | "gateway",
  >(
    key: K,
    value: Partial<Config[K]>,
  ) =>
    onConfig((current) => ({
      ...current,
      [key]: { ...current[key], ...value },
    }));
}
function CacheSettings({ config: c, onConfig }: Props) {
  const patch = settingsUpdater(onConfig);
  return (
    <>
      <Option
        label="Cache technology"
        value={c.cache.technology}
        choices={[
          ["generic", "Generic cache"],
          ["redis", "Redis"],
          ["memcached", "Memcached"],
        ]}
        onChange={(v) =>
          patch("cache", {
            technology: v as Config["cache"]["technology"],
            policy: "allkeys-lru",
          })
        }
      />
      <Toggle
        label="Cache online"
        value={c.cache.online}
        onChange={(online) => patch("cache", { online })}
      />
      {c.cache.technology !== "generic" && (
        <>
          <Numeric
            label="Memory limit · key + value bytes"
            value={c.cache.maxmemory}
            min={64}
            max={1000000}
            onChange={(maxmemory) => patch("cache", { maxmemory })}
          />
          <Option
            label="Memory policy"
            value={c.cache.policy}
            choices={
              c.cache.technology === "redis"
                ? [
                    ["allkeys-lru", "allkeys-lru"],
                    ["allkeys-lfu", "allkeys-lfu"],
                    ["volatile-lru", "volatile-lru"],
                    ["volatile-ttl", "volatile-ttl"],
                    ["noeviction", "noeviction"],
                  ]
                : [
                    ["allkeys-lru", "LRU eviction"],
                    ["noeviction", "Reject when full"],
                  ]
            }
            onChange={(policy) =>
              patch("cache", {
                policy: policy as Config["cache"]["policy"],
              })
            }
          />
          {c.cache.technology === "memcached" && (
            <Numeric
              label="Maximum item value bytes"
              value={c.cache.maxItemBytes}
              max={1000000}
              onChange={(maxItemBytes) => patch("cache", { maxItemBytes })}
            />
          )}
          <Note>
            Memory counts UTF-8 key and value bytes. Eviction uses deterministic
            LRU or frequency counts. Volatile policies can evict only expiring
            keys.
          </Note>
          <Numeric
            label="Cache-aside expiry · seconds"
            value={c.ttl}
            max={3600}
            onChange={(ttl) => onConfig((current) => ({ ...current, ttl }))}
          />
        </>
      )}
    </>
  );
}
function StreamSettings({ config: c, onConfig, state }: Props) {
  const patch = settingsUpdater(onConfig);
  return (
    <>
      <div className="technology-field">Apache Kafka</div>
      <Text
        label="Topic"
        value={c.kafka.topic}
        onChange={(topic) => {
          if (!state.kafka.produced) patch("kafka", { topic });
        }}
      />
      {state.kafka.produced > 0 && (
        <Note>Reset execution before renaming the topic.</Note>
      )}
      <Numeric
        label="Partitions"
        value={c.kafka.partitions}
        min={Math.max(1, state.kafka.partitions.length)}
        max={12}
        onChange={(partitions) => patch("kafka", { partitions })}
      />
      <Numeric
        label="Replication factor"
        value={c.kafka.replicationFactor}
        max={5}
        onChange={(replicationFactor) =>
          patch("kafka", {
            replicationFactor,
            minISR: Math.min(c.kafka.minISR, replicationFactor),
            inSyncReplicas: Math.min(c.kafka.inSyncReplicas, replicationFactor),
          })
        }
      />
      <Numeric
        label="min.insync.replicas"
        value={c.kafka.minISR}
        max={c.kafka.replicationFactor}
        onChange={(minISR) => patch("kafka", { minISR })}
      />
      <Numeric
        label="Available in-sync replicas"
        value={c.kafka.inSyncReplicas}
        min={0}
        max={c.kafka.replicationFactor}
        onChange={(inSyncReplicas) => patch("kafka", { inSyncReplicas })}
      />
      <Numeric
        label="retention.ms"
        value={c.kafka.retentionMs}
        min={1000}
        max={3600000}
        onChange={(retentionMs) => patch("kafka", { retentionMs })}
      />
      <Numeric
        label="Segment window · ms"
        value={c.kafka.segmentMs}
        min={1000}
        onChange={(segmentMs) => patch("kafka", { segmentMs })}
      />
      <Option
        label="Partition assignment"
        value={c.kafka.assignor}
        choices={[
          ["range", "Range"],
          ["round-robin", "Round robin"],
        ]}
        onChange={(assignor) =>
          patch("kafka", {
            assignor: assignor as Config["kafka"]["assignor"],
          })
        }
      />
      <Toggle
        label="Kafka online"
        value={c.kafka.online}
        onChange={(online) => patch("kafka", { online })}
      />
      <Note>
        Each partition has one owner per consumer group. Retention removes
        sealed segments. acks=all requires the minimum ISR.
      </Note>
    </>
  );
}
function ProducerSettings({ config: c, onConfig }: Props) {
  const patch = settingsUpdater(onConfig);
  return (
    <>
      <Text
        label="Message key"
        value={c.producer.key}
        onChange={(key) => patch("producer", { key })}
      />
      <Text
        label="Message payload"
        value={c.producer.payload}
        large
        onChange={(payload) => patch("producer", { payload })}
      />
      <Option
        label="Kafka acknowledgments"
        value={c.producer.acks}
        choices={[
          ["all", "acks=all"],
          ["1", "acks=1"],
        ]}
        onChange={(acks) => patch("producer", { acks: acks as "all" | "1" })}
      />
      <Option
        label="Kafka partition selection"
        value={c.producer.partitioner}
        choices={[
          ["key-hash", "Deterministic key hash"],
          ["round-robin", "Round robin"],
        ]}
        onChange={(partitioner) =>
          patch("producer", {
            partitioner: partitioner as Config["producer"]["partitioner"],
          })
        }
      />
      <Note>
        The same key stays in one partition until the partition count changes.
        Produce messages in the Technology lab.
      </Note>
    </>
  );
}
function ConsumerSettings({ config: c, onConfig, id }: Props) {
  const consumer = consumerSettings(c, id);
  const changeConsumer = (value: Partial<typeof consumer>) =>
    onConfig((current) => ({
      ...current,
      consumerOverrides: {
        ...current.consumerOverrides,
        [id]: { ...current.consumerOverrides[id], ...value },
      },
    }));
  return (
    <>
      <Text
        label="group.id"
        deferred
        value={consumer.groupId}
        onChange={(groupId) => {
          if (groupId.trim()) changeConsumer({ groupId });
        }}
      />
      <Option
        label="auto.offset.reset"
        value={consumer.offsetReset}
        choices={[
          ["earliest", "earliest"],
          ["latest", "latest"],
        ]}
        onChange={(offsetReset) =>
          changeConsumer({
            offsetReset: offsetReset as "earliest" | "latest",
          })
        }
      />
      <Numeric
        label="Record processing · ms"
        value={consumer.processingMs}
        onChange={(processingMs) => changeConsumer({ processingMs })}
      />
      <Toggle
        label="enable.auto.commit"
        value={consumer.autoCommit}
        onChange={(autoCommit) => changeConsumer({ autoCommit })}
      />
      <Numeric
        label="auto.commit.interval.ms"
        value={consumer.commitInterval}
        min={100}
        onChange={(commitInterval) => changeConsumer({ commitInterval })}
      />
      <Toggle
        label="Consumer online"
        value={consumer.online}
        onChange={(online) => changeConsumer({ online })}
      />
      <Note>
        Apply group.id with Enter or by leaving the field. Stop a consumer
        before committing to observe replay on rejoin. Offsets count the next
        record to consume. This lab commits after processing.
      </Note>
    </>
  );
}
function QueueSettings({ config: c, onConfig }: Props) {
  const patch = settingsUpdater(onConfig);
  return (
    <>
      <Option
        label="Queue technology"
        value={c.queueSettings.technology}
        choices={[
          ["rabbitmq", "RabbitMQ quorum queue"],
          ["sqs", "Amazon SQS Standard"],
        ]}
        onChange={(technology) =>
          patch("queueSettings", {
            technology: technology as "rabbitmq" | "sqs",
          })
        }
      />
      <Toggle
        label="Queue online"
        value={c.queueSettings.online}
        onChange={(online) => patch("queueSettings", { online })}
      />
      <Numeric
        label="Lab queue capacity"
        value={c.queueSettings.capacity}
        max={500}
        onChange={(capacity) => patch("queueSettings", { capacity })}
      />
      <Numeric
        label={
          c.queueSettings.technology === "sqs"
            ? "maxReceiveCount"
            : "Delivery limit"
        }
        value={c.queueSettings.maxDeliveries}
        max={20}
        onChange={(maxDeliveries) => patch("queueSettings", { maxDeliveries })}
      />
      {c.queueSettings.technology === "sqs" && (
        <Numeric
          label="Visibility timeout · ms"
          value={c.queueSettings.visibilityMs}
          min={100}
          onChange={(visibilityMs) => patch("queueSettings", { visibilityMs })}
        />
      )}
      <Note>
        {c.queueSettings.technology === "sqs"
          ? "A received message becomes visible again unless the worker deletes it before the timeout."
          : "Unacknowledged messages return to the queue when a worker connection closes. Prefetch limits deliveries awaiting acknowledgment."}{" "}
        Repeated failures move messages to the dead-letter queue. Changing
        technology recreates the queue.
      </Note>
    </>
  );
}
function WorkerSettings({ config: c, onConfig, id }: Props) {
  const worker = workerSettings(c, id);
  const changeWorker = (value: Partial<typeof worker>) =>
    onConfig((current) => ({
      ...current,
      workerOverrides: {
        ...current.workerOverrides,
        [id]: { ...current.workerOverrides[id], ...value },
      },
    }));
  return (
    <>
      <Toggle
        label="Worker online"
        value={worker.online}
        onChange={(online) => changeWorker({ online })}
      />
      <Numeric
        label={
          c.queueSettings.technology === "rabbitmq"
            ? "Prefetch count"
            : "Maximum in-flight messages"
        }
        value={worker.prefetch}
        max={16}
        onChange={(prefetch) => changeWorker({ prefetch })}
      />
      <Numeric
        label="Message processing · ms"
        value={worker.processingMs}
        onChange={(processingMs) => changeWorker({ processingMs })}
      />
      <Option
        label="Acknowledgment"
        value={worker.ack}
        choices={[
          ["automatic", "Acknowledge after success"],
          ["manual", "Wait for manual acknowledgment"],
        ]}
        onChange={(ack) => changeWorker({ ack: ack as "automatic" | "manual" })}
      />
      <Toggle
        label="Fail every delivery"
        value={worker.fail}
        onChange={(fail) => changeWorker({ fail })}
      />
    </>
  );
}
function DatabaseSettings({ config: c, onConfig }: Props) {
  const patch = settingsUpdater(onConfig);
  return (
    <>
      <Option
        label="Database technology"
        value={c.database.technology}
        choices={[
          ["generic", "Generic database"],
          ["postgresql", "PostgreSQL"],
          ["mongodb", "MongoDB"],
          ["dynamodb", "DynamoDB"],
        ]}
        onChange={(technology) =>
          patch("database", {
            technology: technology as Config["database"]["technology"],
            readFrom: "primary",
            indexed: true,
          })
        }
      />
      {c.database.technology !== "generic" && (
        <>
          <Option
            label={
              c.database.technology === "dynamodb"
                ? "Read consistency"
                : "Read target"
            }
            value={c.database.readFrom}
            choices={
              c.database.technology === "dynamodb"
                ? [
                    ["primary", "Strongly consistent"],
                    ["replica", "Eventually consistent"],
                  ]
                : [
                    ["primary", "Primary"],
                    ["replica", "Read replica / secondary"],
                  ]
            }
            onChange={(readFrom) =>
              patch("database", {
                readFrom: readFrom as "primary" | "replica",
              })
            }
          />
          <Numeric
            label="Modeled replication delay · ms"
            value={c.database.replicationMs}
            min={0}
            onChange={(replicationMs) => patch("database", { replicationMs })}
          />
          {c.database.technology === "dynamodb" ? (
            <Numeric
              label="Read capacity units / second"
              value={c.database.readCapacity}
              max={100}
              onChange={(readCapacity) => patch("database", { readCapacity })}
            />
          ) : (
            <Toggle
              label="Lookup index available"
              value={c.database.indexed}
              onChange={(indexed) => patch("database", { indexed })}
            />
          )}
          <Note>
            {c.database.technology === "dynamodb"
              ? "Each modeled item is under 4 KB. Strong reads use 1 unit. Eventual reads use 0.5 units."
              : "Indexed lookups examine one matching record. A scan examines every record and adds 20 ms per record in this lab."}{" "}
            Change a record in the Technology lab to compare primary and replica
            reads.
          </Note>
        </>
      )}
    </>
  );
}
function BalancerSettings({ config: c, onConfig }: Props) {
  const patch = settingsUpdater(onConfig);
  return (
    <>
      <Option
        label="Traffic technology"
        value={c.gateway.technology}
        choices={[
          ["load-balancer", "HTTP load balancer"],
          ["api-gateway", "API gateway · token bucket"],
        ]}
        onChange={(technology) =>
          patch("gateway", {
            technology: technology as Config["gateway"]["technology"],
          })
        }
      />
      {c.gateway.technology === "api-gateway" && (
        <>
          <Numeric
            label="Refill rate · requests / second"
            value={c.gateway.rate}
            max={100}
            onChange={(rate) => patch("gateway", { rate })}
          />
          <Numeric
            label="Burst capacity · tokens"
            value={c.gateway.burst}
            max={100}
            onChange={(burst) => patch("gateway", { burst })}
          />
          <Note>
            Each arrival consumes one token before routing. Empty buckets return
            HTTP 429. Simulated time refills the bucket.
          </Note>
        </>
      )}
    </>
  );
}
const panels: Partial<Record<Role, (props: Props) => ReactNode>> = {
  cache: CacheSettings,
  stream: StreamSettings,
  producer: ProducerSettings,
  consumer: ConsumerSettings,
  queue: QueueSettings,
  worker: WorkerSettings,
  database: DatabaseSettings,
  balancer: BalancerSettings,
};
export default function TechnologyInspector(props: Props) {
  const Panel = panels[props.role];
  const reference = technologyReference(props.role, props.config);
  return Panel ? (
    <div className="technology-settings">
      <Panel {...props} />
      {reference && (
        <a
          className="technology-reference"
          href={reference}
          target="_blank"
          rel="noreferrer"
        >
          Technology documentation ↗
        </a>
      )}
    </div>
  ) : (
    <div className="technology-field">
      {props.role === "client" ? "HTTP client" : "Node.js"}
    </div>
  );
}
