import {
  useRef,
  type ReactNode,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { Node, Edge } from "@xyflow/react";
import {
  Activity,
  Check,
  Clock3,
  Database,
  Plus,
  Settings2,
  SlidersHorizontal,
  Trash2,
  Zap,
} from "lucide-react";
import {
  backendSettings,
  consumerSettings,
  type BackendSettings,
  type Config,
  type Role,
  type Snapshot,
} from "./engine";
import TechnologyInspector from "./TechnologyInspector";
import { catalog } from "./board";
import { icons } from "./visuals";
type Props = {
  node?: Node;
  nodes: Node[];
  edges: Edge[];
  config: Config;
  state: Snapshot;
  path: string;
  onPath: (path: string) => void;
  onConfig: Dispatch<SetStateAction<Config>>;
  onSelect: (id: string) => void;
  onRename: (name: string) => void;
  onRemove: () => void;
  onMessage: (type: string, extra?: Record<string, unknown>) => void;
};
function Field({
  label,
  id,
  children,
}: {
  label: string;
  id: string;
  children: ReactNode;
}) {
  return (
    <>
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      {children}
    </>
  );
}
function NumberField({
  label,
  id,
  value,
  min = 0,
  max = 60000,
  unit,
  onChange,
}: {
  label: string;
  id: string;
  value: number;
  min?: number;
  max?: number;
  unit: string;
  onChange: (value: number) => void;
}) {
  return (
    <Field label={label} id={id}>
      <div className="unit-field">
        <input
          id={id}
          aria-label={label}
          type="number"
          min={min}
          max={max}
          value={value}
          onChange={(e) => {
            const value = e.currentTarget.valueAsNumber;
            if (Number.isFinite(value))
              onChange(Math.min(max, Math.max(min, Math.floor(value))));
          }}
        />
        <span>{unit}</span>
      </div>
    </Field>
  );
}
function Availability({
  online,
  label,
  onChange,
}: {
  online: boolean;
  label: string;
  onChange: () => void;
}) {
  return (
    <Field label="AVAILABILITY" id="availability">
      <button
        id="availability"
        aria-label={`${label} ${online ? "online" : "offline"}`}
        className={`availability ${online ? "" : "disabled"}`}
        onClick={onChange}
      >
        <span className="status-dot" />
        {label} {online ? "online" : "offline"}
        <span className="toggle">
          <i />
        </span>
      </button>
    </Field>
  );
}
function liveMetrics(
  role: Role | undefined,
  id: string,
  state: Snapshot,
  config: Config,
): [string, number][] {
  switch (role) {
    case "database":
      return [
        ["Reads", state.database.reads],
        ["Records", Object.keys(state.database.primary).length],
      ];
    case "backend":
      return [
        ["Completed", state.backends[id]?.completed ?? 0],
        ["Waiting", state.backends[id]?.queued ?? 0],
      ];
    case "producer":
      return [
        ["Produced", state.kafka.produced + state.queueLab.published],
        ["Rejected", state.kafka.rejected + state.queueLab.rejected],
      ];
    case "stream":
      return [
        [
          "Retained",
          state.kafka.partitions.reduce((sum, p) => sum + p.records.length, 0),
        ],
        ["Replays", state.kafka.duplicates],
      ];
    case "consumer":
      return [
        [
          "Recent deliveries",
          state.kafka.deliveries.filter((d) => d.consumer === id).length,
        ],
        [
          "Partitions",
          state.kafka.groups
            .find((g) => g.id === consumerSettings(config, id).groupId)
            ?.owners.filter((owner) => owner === id).length ?? 0,
        ],
      ];
    case "queue":
      return [
        [
          "Ready",
          state.queueLab.messages.filter((m) => m.state === "ready").length,
        ],
        [
          "Dead letters",
          state.queueLab.messages.filter((m) => m.state === "dead").length,
        ],
      ];
    case "worker":
      return [
        [
          "In flight",
          state.queueLab.inProgress.filter((job) => job.worker === id).length +
            state.queueLab.messages.filter(
              (m) => m.worker === id && m.state === "unacked",
            ).length,
        ],
        [
          "Recent effects",
          state.queueLab.events.filter(
            (e) => e.edge === `queue-${id}` && e.text.includes("Processed"),
          ).length,
        ],
      ];
    case "balancer":
      if (config.gateway.technology === "api-gateway")
        return [
          ["Admitted", state.gateway.allowed],
          ["Rate limited", state.gateway.rejected],
        ];
  }
  return [
    ["Responses", state.metrics.completed],
    ["Failed", state.metrics.failed],
  ];
}
export default function Inspector({
  node,
  nodes,
  edges,
  config,
  state,
  path,
  onPath,
  onConfig,
  onSelect,
  onRename,
  onRemove,
  onMessage,
}: Props) {
  const scroll = useRef<HTMLDivElement>(null);
  const live = useRef<HTMLDivElement>(null);
  const role = node?.data.role as Role | undefined;
  const item = catalog.find((item) => item.role === role);
  const Icon = role ? icons[role] : SlidersHorizontal;
  const settings = backendSettings(config, node?.id ?? "backend");

  const update = (patch: Partial<Config>) =>
    onConfig((current) => ({ ...current, ...patch }));
  const updateBackend = (patch: Partial<BackendSettings>) =>
    onConfig((current) => ({
      ...current,
      backendOverrides: {
        ...current.backendOverrides,
        [node!.id]: { ...current.backendOverrides?.[node!.id], ...patch },
      },
    }));
  const toggleBackend = (id: string) =>
    onConfig((current) => ({
      ...current,
      backendOverrides: {
        ...current.backendOverrides,
        [id]: {
          ...current.backendOverrides?.[id],
          online: !backendSettings(current, id).online,
        },
      },
    }));
  const updateBalancer = (patch: Partial<Config["balancer"]>) =>
    onConfig((current) => ({
      ...current,
      balancer: { ...current.balancer, ...patch },
    }));
  const targets = nodes.filter(
    (n) =>
      n.data.role === "backend" &&
      edges.some((e) => e.source === "balancer" && e.target === n.id),
  );
  return (
    <aside className="inspector">
      <div className="panel-heading">
        <h2>Inspector</h2>
        <SlidersHorizontal size={15} />
      </div>
      {!node || !item ? (
        <div className="inspector-empty">
          <SlidersHorizontal size={26} />
          <strong>Select a component.</strong>
          <p>
            Inspect its configuration, state, and place in the request path.
          </p>
        </div>
      ) : (
        <>
          <div className="inspector-component">
            <span className={`catalog-icon ${role}`}>
              <Icon size={22} />
            </span>
            <div>
              <strong>{String(node.data.name)}</strong>
              <span>{item.name} configuration</span>
            </div>
            <button
              className="icon-button"
              title="Remove component"
              onClick={onRemove}
            >
              <Trash2 size={14} />
            </button>
          </div>
          <div className="inspector-tabs">
            <button
              className="active"
              onClick={() =>
                scroll.current?.scrollTo({ top: 0, behavior: "smooth" })
              }
            >
              <Settings2 size={13} /> Configure
            </button>
            <button
              onClick={() =>
                live.current?.scrollIntoView({
                  behavior: "smooth",
                  block: "center",
                })
              }
            >
              <Activity size={13} /> Live state
            </button>
          </div>
          <div className="inspector-scroll" ref={scroll}>
            <Field label="NAME" id="component-name">
              <input
                id="component-name"
                aria-label="Component name"
                className="field"
                maxLength={80}
                value={String(node.data.name)}
                onChange={(e) => onRename(e.target.value)}
              />
            </Field>
            <TechnologyInspector
              role={role!}
              id={node.id}
              config={config}
              state={state}
              onConfig={onConfig}
            />
            <div className="section-divider" />
            {role === "backend" && (
              <>
                <h3 className="inspector-subtitle">Instance behavior</h3>
                <Availability
                  label="Backend"
                  online={settings.online}
                  onChange={() => toggleBackend(node.id)}
                />
                <Field label="GET ROUTE" id="route">
                  <input
                    id="route"
                    aria-label="Backend route"
                    className="field"
                    value={settings.route}
                    onChange={(e) => updateBackend({ route: e.target.value })}
                  />
                </Field>
                <NumberField
                  label="Backend timeout"
                  id="timeout"
                  value={settings.timeout}
                  min={1}
                  unit="ms"
                  onChange={(timeout) => updateBackend({ timeout })}
                />
                <NumberField
                  label="Backend concurrency"
                  id="backend-concurrency"
                  value={settings.concurrency}
                  min={1}
                  max={16}
                  unit="requests"
                  onChange={(concurrency) => updateBackend({ concurrency })}
                />
                <NumberField
                  label="Backend queue limit"
                  id="backend-queue-limit"
                  value={settings.queueLimit}
                  max={500}
                  unit="waiting"
                  onChange={(queueLimit) => updateBackend({ queueLimit })}
                />
                <NumberField
                  label="Processing delay"
                  id="processing-delay"
                  value={settings.processingDelay}
                  unit="ms"
                  onChange={(processingDelay) =>
                    updateBackend({ processingDelay })
                  }
                />
                <p className="field-help">
                  Extra simulated work before dependency calls. Increase it to
                  model a slower instance.
                </p>
                <div className="info-note">
                  <Zap size={15} />
                  <p>
                    Each instance has its own execution slots and waiting queue.
                    All connected instances share the cache and database.
                  </p>
                </div>
                <p className="field-help">
                  Taking an instance offline rejects its waiting requests.
                  Active requests fail at their next decision. New requests use
                  healthy targets.
                </p>
              </>
            )}
            {role === "balancer" && (
              <>
                <h3 className="inspector-subtitle">Routing behavior</h3>
                <Availability
                  label="Load balancer"
                  online={config.balancer.online}
                  onChange={() =>
                    onConfig((current) => ({
                      ...current,
                      balancer: {
                        ...current.balancer,
                        online: !current.balancer.online,
                      },
                    }))
                  }
                />
                <Field label="ROUTING POLICY" id="routing-policy">
                  <select
                    id="routing-policy"
                    aria-label="Routing policy"
                    className="field"
                    value={config.balancer.policy}
                    onChange={(e) =>
                      updateBalancer({
                        policy: e.target.value as Config["balancer"]["policy"],
                      })
                    }
                  >
                    <option value="round-robin">Round robin</option>
                    <option value="least-connections">Least connections</option>
                  </select>
                </Field>
                <p className="field-help">
                  {config.balancer.policy === "round-robin"
                    ? "Send each arrival to the next healthy target in turn."
                    : "Choose the target with the fewest active and waiting requests. Ties rotate between equal targets."}
                </p>
                <div className="field-label">
                  CONNECTED TARGETS · {targets.length}
                </div>
                {targets.length ? (
                  targets.map((target) => {
                    const backend = state.backends[target.id];
                    const online = backendSettings(config, target.id).online;
                    return (
                      <div className="target-row" key={target.id}>
                        <button onClick={() => onSelect(target.id)}>
                          <span
                            className={`status-dot ${online ? "" : "offline"}`}
                          />
                          <span>
                            <strong>{String(target.data.name)}</strong>
                            <small>
                              {backend?.active ?? 0} active ·{" "}
                              {backend?.queued ?? 0} waiting
                            </small>
                          </span>
                        </button>
                        <button
                          className={`health-button ${online ? "" : "offline"}`}
                          aria-label={`${online ? "Disable" : "Enable"} ${String(target.data.name)}`}
                          onClick={() => toggleBackend(target.id)}
                        >
                          {online ? "Online" : "Offline"}
                        </button>
                      </div>
                    );
                  })
                ) : (
                  <p className="field-help">
                    Connect this balancer to a backend's input port.
                  </p>
                )}
                <div className="info-note">
                  <Activity size={15} />
                  <p>
                    Health changes apply immediately to new arrivals. A selected
                    target with a full queue returns 429. Requests are not
                    retried.
                  </p>
                </div>
              </>
            )}
            {role === "cache" && config.cache.technology === "generic" && (
              <>
                <h3 className="inspector-subtitle">Cache behavior</h3>
                <NumberField
                  label="Cache time to live"
                  id="cache-ttl"
                  value={config.ttl}
                  min={1}
                  max={3600}
                  unit="seconds"
                  onChange={(ttl) => update({ ttl })}
                />
                <p className="field-help">
                  How long a stored entry remains valid.
                </p>
                <NumberField
                  label="Cache capacity"
                  id="cache-capacity"
                  value={config.capacity}
                  min={1}
                  max={1000}
                  unit="entries"
                  onChange={(capacity) => update({ capacity })}
                />
                <Field label="EVICTION POLICY" id="eviction">
                  <select
                    id="eviction"
                    aria-label="Eviction policy"
                    className="field"
                    value={config.eviction}
                    onChange={(e) =>
                      update({ eviction: e.target.value as Config["eviction"] })
                    }
                  >
                    <option value="LRU">Least recently used (LRU)</option>
                    <option value="FIFO">First in, first out (FIFO)</option>
                  </select>
                </Field>
                <p className="field-help">
                  When full, remove the{" "}
                  {config.eviction === "LRU"
                    ? "least recently accessed"
                    : "oldest stored"}{" "}
                  entry.
                </p>
                <div className="field-label">CACHE KEY</div>
                <div className="code-field">
                  user:<span>{"{id}"}</span>
                </div>
              </>
            )}
            {role === "database" && (
              <>
                <h3 className="inspector-subtitle">Database behavior</h3>
                <Availability
                  label="Database"
                  online={config.online}
                  onChange={() =>
                    onConfig((current) => ({
                      ...current,
                      online: !current.online,
                    }))
                  }
                />
                <NumberField
                  label="Database read delay"
                  id="read-delay"
                  value={config.delay}
                  min={1}
                  unit="ms"
                  onChange={(delay) => update({ delay })}
                />
                <div className="field-label">SEED RECORDS · USERS</div>
                {Object.values(config.records).map((record) => (
                  <div className="record" key={record.id}>
                    <span className="record-avatar">{record.name[0]}</span>
                    <div>
                      <strong>{record.name}</strong>
                      <small>
                        id: {record.id} · {record.email}
                      </small>
                    </div>
                  </div>
                ))}
                <button
                  className="secondary-button"
                  onClick={() =>
                    onConfig((current) => {
                      const id = String(
                        Math.max(
                          0,
                          ...Object.keys(current.records).map(Number),
                        ) + 1,
                      );
                      return {
                        ...current,
                        records: {
                          ...current.records,
                          [id]: {
                            id,
                            name: `User ${id}`,
                            email: `user${id}@example.com`,
                          },
                        },
                      };
                    })
                  }
                >
                  <Plus size={13} /> Add seed record
                </button>
              </>
            )}
            {role === "client" && (
              <>
                <h3 className="inspector-subtitle">Client behavior</h3>
                <Field label="REQUEST PATH" id="client-path">
                  <input
                    id="client-path"
                    aria-label="Client request path"
                    className="field"
                    value={path}
                    onChange={(e) => onPath(e.target.value)}
                  />
                </Field>
                <p className="field-help">
                  Send one request, a burst, or sustained traffic from the
                  execution panel.
                </p>
              </>
            )}
            <div className="section-divider" />
            <div ref={live} className="state-heading">
              <h3 className="inspector-subtitle">Live state</h3>
              <span>
                <span className="tiny-dot" /> LIVE
              </span>
            </div>
            {role === "cache" ? (
              <>
                <div className="state-metrics">
                  <div>
                    <span>Entries</span>
                    <b>
                      {state.entries.length}
                      <small>
                        {config.cache.technology === "generic"
                          ? ` / ${config.capacity}`
                          : " keys"}
                      </small>
                    </b>
                  </div>
                  <div>
                    <span>Hit rate</span>
                    <b>
                      {state.hits + state.misses
                        ? Math.round(
                            (state.hits / (state.hits + state.misses)) * 100,
                          )
                        : 0}
                      <small>%</small>
                    </b>
                  </div>
                </div>
                <div className="cache-state">
                  {state.entries.length ? (
                    state.entries.map((entry) => (
                      <details className="cache-record" key={entry.key}>
                        <summary>
                          <code>{entry.key}</code>
                          <span>
                            {Number.isFinite(entry.expires)
                              ? `${Math.max(0, Math.ceil((entry.expires - state.now) / 1000))}s`
                              : "Persistent"}
                          </span>
                        </summary>
                        <pre>{JSON.stringify(entry.value, null, 2)}</pre>
                      </details>
                    ))
                  ) : (
                    <>
                      <Database size={20} />
                      <span>Your cache is empty.</span>
                      <small>Send a request to fill it.</small>
                    </>
                  )}
                </div>
                <button
                  className="secondary-button"
                  onClick={() => onMessage("expire")}
                >
                  <Clock3 size={13} /> Expire all entries
                </button>
                <button
                  className="text-button"
                  onClick={() =>
                    onMessage("advance", { value: (config.ttl + 1) * 1000 })
                  }
                >
                  Advance simulated time by {config.ttl + 1}s
                </button>
              </>
            ) : (
              <div className="state-metrics">
                {liveMetrics(role, node.id, state, config).map(
                  ([label, value]) => (
                    <div key={label}>
                      <span>{label}</span>
                      <b>{value}</b>
                    </div>
                  ),
                )}
              </div>
            )}
          </div>
          <div className="inspector-foot">
            <Check size={13} /> Configuration applies to future decisions
          </div>
        </>
      )}
    </aside>
  );
}
