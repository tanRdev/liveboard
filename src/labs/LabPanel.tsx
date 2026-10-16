import { useState, type ReactNode } from "react";
import type { Node } from "@xyflow/react";
import type { Config, Snapshot } from "../simulation/engine";
import { memoryUsed, valueText } from "../simulation/cache";
type Props = {
  config: Config;
  state: Snapshot;
  nodes: Node[];
  onMessage: (type: string, extra?: Record<string, unknown>) => void;
  onSelect: (id: string) => void;
};
function Empty({ children }: { children: ReactNode }) {
  return <p className="lab-empty">{children}</p>;
}
function CachePanel({ config, state, onMessage, onSelect }: Props) {
  const [command, setCommand] = useState('SET greeting "hello" EX 10');
  return (
    <div className="lab-columns">
      <section>
        <div className="lab-toolbar">
          <b>
            {config.cache.technology === "redis"
              ? "Redis command console"
              : config.cache.technology === "memcached"
                ? "Memcached state"
                : "Cache state"}
          </b>
          <button onClick={() => onSelect("cache")}>Configure cache</button>
          <span>
            {memoryUsed(state.entries)} / {config.cache.maxmemory} modeled bytes
          </span>
        </div>
        {config.cache.technology === "redis" ? (
          <>
            <form
              className="command-form"
              onSubmit={(e) => {
                e.preventDefault();
                onMessage("cacheCommand", { command });
              }}
            >
              <span>redis&gt;</span>
              <input
                aria-label="Redis command"
                maxLength={4096}
                value={command}
                onChange={(e) => setCommand(e.target.value)}
              />
              <button type="submit">Run</button>
            </form>
            <div className="command-examples">
              {[
                "PING",
                "GET user:1",
                "SET lock owner NX EX 5",
                "INCR visits",
                "TTL lock",
                "DEL lock",
              ].map((text) => (
                <button key={text} onClick={() => setCommand(text)}>
                  {text}
                </button>
              ))}
            </div>
            <div className="console-log" aria-live="polite">
              {state.cacheLog.length ? (
                state.cacheLog
                  .slice()
                  .reverse()
                  .map((log) => (
                    <div key={log.id}>
                      <code>&gt; {log.command}</code>
                      <pre
                        className={
                          /^(ERR|OOM|SERVER_ERROR)/.test(log.reply)
                            ? "error-text"
                            : ""
                        }
                      >
                        {log.reply}
                      </pre>
                    </div>
                  ))
              ) : (
                <Empty>
                  Run a command. Keys share the same cache used by backend
                  requests.
                </Empty>
              )}
            </div>
          </>
        ) : (
          <Empty>
            {config.cache.technology === "generic"
              ? "Select Redis or Memcached in the inspector."
              : "Send HTTP requests to fill the cache. Lower memory or the item limit to test rejected writes."}
          </Empty>
        )}
      </section>
      <section>
        <div className="lab-toolbar">
          <b>Stored keys · {state.entries.length}</b>
          <button onClick={() => onMessage("expire")}>Clear cache</button>
          <button onClick={() => onMessage("advance", { value: 5000 })}>
            +5 seconds
          </button>
        </div>
        <table className="lab-table">
          <thead>
            <tr>
              <th>Key</th>
              <th>Expiry</th>
              <th>Value</th>
            </tr>
          </thead>
          <tbody>
            {state.entries.map((e) => (
              <tr key={e.key}>
                <td>
                  <code>{e.key}</code>
                </td>
                <td>
                  {Number.isFinite(e.expires)
                    ? `${Math.max(0, Math.ceil((e.expires - state.now) / 1000))}s`
                    : "Persistent"}
                </td>
                <td>
                  <code>{valueText(e.value)}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
function KafkaPanel({ config, state, onMessage, onSelect }: Props) {
  const [recordId, setRecordId] = useState<number | null>(null);
  const record = state.kafka.partitions
    .flatMap((p) => p.records)
    .find((r) => r.id === recordId);
  return (
    <div className="lab-columns">
      <section>
        <div className="lab-toolbar">
          <b>Topic {config.kafka.topic}</b>
          {[1, 10, 100].map((count) => (
            <button key={count} onClick={() => onMessage("produce", { count })}>
              Produce {count}
            </button>
          ))}
          <button onClick={() => onSelect("producer")}>
            Producer settings
          </button>
        </div>
        <p className="lab-reply" aria-live="polite">
          {state.kafka.reply ||
            "Produce records. Select a record to inspect its payload."}
        </p>
        <div className="partition-list">
          {state.kafka.partitions.map((p) => (
            <div className="partition-row" key={p.id}>
              <b>P{p.id}</b>
              <span>
                offset {p.start}–{p.end}
              </span>
              <div>
                {p.records.slice(-30).map((r) => (
                  <button
                    key={r.id}
                    aria-label={`Partition ${p.id} offset ${r.offset}`}
                    className={recordId === r.id ? "active" : ""}
                    onClick={() => setRecordId(r.id)}
                    title={`${r.key} · ${valueText(r.value)}`}
                  >
                    {r.offset}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
        {record && (
          <details className="lab-payload" open>
            <summary>
              Record {record.id} · key {record.key || "(empty)"} · partition{" "}
              {record.partition} · offset {record.offset}
            </summary>
            <pre>{JSON.stringify(record.value, null, 2)}</pre>
          </details>
        )}
        <div className="lab-metrics">
          <span>{state.kafka.produced} produced</span>
          <span>{state.kafka.processed} processed</span>
          <span>{state.kafka.duplicates} replays</span>
          <span>{state.kafka.rejected} rejected</span>
        </div>
      </section>
      <section>
        <div className="lab-toolbar">
          <b>Consumer groups</b>
          <button onClick={() => onSelect("stream")}>Topic settings</button>
        </div>
        {state.kafka.groups.map((group) => (
          <div className="group-card" key={group.id}>
            <div className="lab-toolbar">
              <strong>{group.id}</strong>
              <span>generation {group.generation}</span>
              <button
                onClick={() => onMessage("commit", { groupId: group.id })}
              >
                Commit
              </button>
              <button
                onClick={() => onMessage("replay", { groupId: group.id })}
              >
                Seek earliest
              </button>
            </div>
            <table className="lab-table">
              <thead>
                <tr>
                  <th>Partition</th>
                  <th>Owner</th>
                  <th>Next</th>
                  <th>Committed</th>
                  <th>Lag</th>
                </tr>
              </thead>
              <tbody>
                {state.kafka.partitions.map((p) => (
                  <tr key={p.id}>
                    <td>P{p.id}</td>
                    <td>
                      <button onClick={() => onSelect(group.owners[p.id])}>
                        {group.owners[p.id] || "Unassigned"}
                      </button>
                    </td>
                    <td>{group.positions[p.id]}</td>
                    <td>
                      {group.committed[p.id] === -1
                        ? "None"
                        : group.committed[p.id]}
                    </td>
                    <td>
                      {Math.max(
                        0,
                        p.end - Math.max(p.start, group.committed[p.id]),
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
        <div className="lab-events">
          {state.kafka.events
            .slice(-25)
            .reverse()
            .map((event) => (
              <div key={event.id} className={event.error ? "error-text" : ""}>
                <time>{(event.time / 1000).toFixed(2)}s</time>
                <b>{event.component}</b>
                {event.text}
              </div>
            ))}
        </div>
      </section>
    </div>
  );
}
function QueuePanel({ config, state, onMessage, onSelect }: Props) {
  return (
    <div className="lab-columns">
      <section>
        <div className="lab-toolbar">
          <b>
            {config.queueSettings.technology === "rabbitmq"
              ? "RabbitMQ"
              : "Amazon SQS"}
          </b>
          {[1, 10, 50].map((count) => (
            <button key={count} onClick={() => onMessage("produce", { count })}>
              Publish {count}
            </button>
          ))}
          <button onClick={() => onSelect("queue")}>Configure queue</button>
        </div>
        <div className="lab-metrics">
          <span>
            {state.queueLab.messages.filter((m) => m.state === "ready").length}{" "}
            ready
          </span>
          <span>
            {
              state.queueLab.messages.filter((m) =>
                ["inflight", "unacked"].includes(m.state),
              ).length
            }{" "}
            in flight
          </span>
          <span>{state.queueLab.inProgress.length} processing</span>
          <span>{state.queueLab.acked} acknowledged</span>
          <span>{state.queueLab.redelivered} redeliveries</span>
          <span>{state.queueLab.duplicates} duplicate effects</span>
          <span>
            {state.queueLab.messages.filter((m) => m.state === "dead").length}{" "}
            dead letters
          </span>
        </div>
        <div className="lab-toolbar">
          <button onClick={() => onMessage("ack")}>
            Acknowledge completed
          </button>
          <button onClick={() => onMessage("redrive")}>
            Redrive dead letters
          </button>
          <button onClick={() => onSelect("worker")}>Worker settings</button>
        </div>
        <table className="lab-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>State</th>
              <th>Worker</th>
              <th>Deliveries</th>
              <th>Visibility</th>
              <th>Payload</th>
            </tr>
          </thead>
          <tbody>
            {state.queueLab.messages.slice(-100).map((m) => (
              <tr key={m.id}>
                <td>{m.id}</td>
                <td>
                  <span className={`message-state ${m.state}`}>{m.state}</span>
                </td>
                <td>
                  <button onClick={() => m.worker && onSelect(m.worker)}>
                    {m.worker || "—"}
                  </button>
                </td>
                <td>{m.deliveries}</td>
                <td>
                  {Number.isFinite(m.visibleAt) &&
                  ["inflight", "unacked"].includes(m.state)
                    ? `${Math.max(0, Math.ceil((m.visibleAt - state.now) / 1000))}s`
                    : "—"}
                </td>
                <td>
                  <details>
                    <summary>Inspect</summary>
                    <pre>{JSON.stringify(m.value, null, 2)}</pre>
                  </details>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section>
        <div className="lab-toolbar">
          <b>Delivery decisions</b>
          <span>{state.queueLab.rejected} publishes rejected</span>
        </div>
        <div className="lab-events">
          {state.queueLab.events
            .slice()
            .reverse()
            .map((event) => (
              <div key={event.id} className={event.error ? "error-text" : ""}>
                <time>{(event.time / 1000).toFixed(2)}s</time>
                {event.text}
              </div>
            ))}
        </div>
      </section>
    </div>
  );
}
function DatabasePanel({ config, state, onMessage, onSelect }: Props) {
  const [id, setId] = useState("1"),
    [name, setName] = useState("Alex updated"),
    [email, setEmail] = useState("alex@example.com");
  const query =
    config.database.technology === "postgresql"
      ? `SELECT * FROM users WHERE id = $1;\n$1 = ${JSON.stringify(id)}`
      : config.database.technology === "mongodb"
        ? `db.users.findOne({ id: ${JSON.stringify(id)} })`
        : config.database.technology === "dynamodb"
          ? `GetItem(${JSON.stringify({ TableName: "users", Key: { id: { S: id } }, ConsistentRead: config.database.readFrom === "primary" }, null, 2)})`
          : `GET users/${id}`;
  return (
    <div className="lab-columns">
      <section>
        <div className="lab-toolbar">
          <b>Write a user record</b>
          <button onClick={() => onSelect("database")}>
            Database settings
          </button>
        </div>
        <pre className="database-query">{query}</pre>
        <form
          className="db-write"
          onSubmit={(e) => {
            e.preventDefault();
            onMessage("dbWrite", { record: { id, name, email } });
          }}
        >
          <label>
            ID
            <input
              aria-label="Record ID"
              value={id}
              pattern="[0-9]+"
              maxLength={20}
              required
              onChange={(e) => setId(e.target.value)}
            />
          </label>
          <label>
            Name
            <input
              aria-label="Record name"
              value={name}
              maxLength={200}
              required
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            Email
            <input
              aria-label="Record email"
              value={email}
              maxLength={200}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <button type="submit">Write record</button>
          <button
            type="button"
            onClick={() => onMessage("dbRead", { path: id })}
          >
            Read record
          </button>
        </form>
        <p className="lab-reply" aria-live="polite">
          {state.database.reply ||
            "Write a record, then read before and after the replica catches up."}
        </p>
        <div className="lab-metrics">
          <span>{state.database.writes} writes</span>
          <span>{state.database.pending.length} pending replications</span>
          <span>{state.database.examined} records examined</span>
          <span>{state.database.units} read units</span>
          <span>{state.database.throttled} throttled</span>
        </div>
        <p className="field-help">
          HTTP requests use these records. Clear cached values to observe
          database changes through the backend. Seed records stay in board
          files. Runtime writes reset with execution.
        </p>
      </section>
      <section>
        <table className="lab-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Primary value</th>
              <th>Replica value</th>
              <th>Selected read</th>
            </tr>
          </thead>
          <tbody>
            {Object.values(state.database.primary).map((r) => (
              <tr key={r.id}>
                <td>{r.id}</td>
                <td>{r.name}</td>
                <td>{state.database.replica[r.id]?.name ?? "Pending"}</td>
                <td>
                  {config.database.readFrom === "primary"
                    ? r.name
                    : (state.database.replica[r.id]?.name ?? "Missing")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="lab-toolbar">
          <button
            onClick={() =>
              onMessage("advance", { value: config.database.replicationMs })
            }
          >
            Advance replication delay
          </button>
          <button onClick={() => onMessage("expire")}>Clear cache</button>
        </div>
      </section>
    </div>
  );
}
function GatewayPanel({ config, state, onMessage, onSelect }: Props) {
  return (
    <div className="gateway-lab">
      <div className="lab-toolbar">
        <b>
          {config.gateway.technology === "api-gateway"
            ? "API gateway token bucket"
            : "Load balancer"}
        </b>
        <button onClick={() => onSelect("balancer")}>Configure traffic</button>
        <button
          onClick={() => onMessage("send", { path: "/users/1", count: 10 })}
        >
          Send burst of 10
        </button>
        <button onClick={() => onMessage("advance", { value: 1000 })}>
          +1 second
        </button>
      </div>
      <div className="lab-metrics">
        <span>
          {state.gateway.tokens.toFixed(1)} / {config.gateway.burst} tokens
        </span>
        <span>{state.gateway.allowed} admitted</span>
        <span>{state.gateway.rejected} rate limited</span>
        <span>{config.gateway.rate} tokens / second</span>
      </div>
      <div className="token-bucket">
        {Array.from({ length: config.gateway.burst }, (_, i) => (
          <i
            key={i}
            className={i < Math.floor(state.gateway.tokens) ? "filled" : ""}
          />
        ))}
      </div>
      <p className="field-help">
        Select API gateway to enable the token bucket. Rejected arrivals stop
        before backend assignment. Inspect each HTTP 429 in Requests.
      </p>
    </div>
  );
}
const panels: Record<string, (props: Props) => ReactNode> = {
  Cache: CachePanel,
  Kafka: KafkaPanel,
  Queue: QueuePanel,
  Database: DatabasePanel,
  Gateway: GatewayPanel,
};
export default function LabPanel(props: Props) {
  const { config, nodes } = props;
  const families = [
    ...(nodes.some((n) => n.data.role === "cache") ? ["Cache"] : []),
    ...(nodes.some((n) => n.data.role === "stream") ? ["Kafka"] : []),
    ...(nodes.some((n) => n.data.role === "queue") ? ["Queue"] : []),
    ...(nodes.some((n) => n.data.role === "database") ? ["Database"] : []),
    ...(nodes.some((n) => n.data.role === "balancer") ? ["Gateway"] : []),
  ];
  const [chosen, setChosen] = useState(
    config.gateway.technology === "api-gateway" ? "Gateway" : "",
  );
  const family = families.includes(chosen) ? chosen : families[0];
  const Panel = panels[family];
  return (
    <div className="lab-panel">
      <nav className="lab-nav" aria-label="Technology labs">
        {families.map((f) => (
          <button
            key={f}
            className={family === f ? "active" : ""}
            onClick={() => setChosen(f)}
          >
            {f}
          </button>
        ))}
        <span>Deterministic simulation · shared pause & step controls</span>
      </nav>
      {Panel ? (
        <Panel {...props} />
      ) : (
        <Empty>
          Add a cache, event stream, queue, database, or load balancer to start
          a lab.
        </Empty>
      )}
    </div>
  );
}
