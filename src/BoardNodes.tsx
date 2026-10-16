import { useEffect } from "react";
import {
  Handle,
  Position,
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  useUpdateNodeInternals,
  useNodesInitialized,
  useReactFlow,
  type NodeProps,
  type EdgeProps,
} from "@xyflow/react";
import { Clock3 } from "lucide-react";
import {
  backendSettings,
  consumerSettings,
  workerSettings,
  type Config,
  type Role,
  type Snapshot,
} from "./engine";
import { icons } from "./visuals";
export function ComponentNode({ id, data, selected }: NodeProps) {
  const updateNodeInternals = useUpdateNodeInternals();
  useEffect(() => {
    const frame = requestAnimationFrame(() => updateNodeInternals(id));
    return () => cancelAnimationFrame(frame);
  }, [id, updateNodeInternals]);
  const role = data.role as Role;
  const Icon = icons[role];
  const state = data.state as Snapshot;
  const config = data.config as Config;
  const settings = backendSettings(config, id);
  const backend = state.backends[id];
  const active = backend?.active ?? 0;
  const queued = backend?.queued ?? 0;
  const rejected = backend?.rejected ?? 0;
  const targetIds = new Set(data.targets as string[]);
  const targets = Object.entries(state.backends)
    .filter(([id]) => targetIds.has(id))
    .map(([, stats]) => stats);
  const offline =
    (role === "database" && !config.online) ||
    (role === "backend" && !settings.online) ||
    (role === "balancer" && !config.balancer.online) ||
    (role === "cache" && !config.cache.online) ||
    (role === "stream" && !config.kafka.online) ||
    (role === "consumer" && !consumerSettings(config, id).online) ||
    (role === "queue" && !config.queueSettings.online) ||
    (role === "worker" && !workerSettings(config, id).online);
  return (
    <div
      className={`component-node ${role} ${selected ? "selected" : ""} ${data.active ? "node-active" : ""}`}
    >
      {!["client", "producer"].includes(role) && (
        <Handle type="target" position={Position.Left} />
      )}
      <div className="node-heading">
        <span className={`node-icon ${role}`}>
          <Icon size={21} strokeWidth={1.7} />
        </span>
        <div>
          <strong>{String(data.name)}</strong>
          <span>{String(data.tech)}</span>
        </div>
        <span className={`status-dot ${offline ? "offline" : ""}`} />
      </div>
      <div className="node-content">
        {role === "client" && (
          <>
            <div className="node-code">
              <b>GET</b> {String(data.requestPath)}
            </div>
            <div className="node-detail">
              <span>Requests sent</span>
              <strong>{state.metrics.sent}</strong>
            </div>
          </>
        )}
        {role === "backend" && (
          <>
            <div className="node-code">
              <b>GET</b> {settings.route}
            </div>
            <div className="node-detail">
              <span>
                <span className="tiny-dot" /> Cache-aside
              </span>
              <span>
                {queued
                  ? `${queued} waiting`
                  : `${active} / ${settings.concurrency} active`}
              </span>
            </div>
            <div
              className="active-slots"
              aria-label={`${active} active requests, ${queued} waiting`}
            >
              {Array.from({ length: settings.concurrency }, (_, i) => (
                <i className={i < active ? "occupied" : ""} key={i} />
              ))}
              <span>
                {rejected
                  ? `${rejected} rejected`
                  : `${settings.concurrency} execution ${settings.concurrency === 1 ? "slot" : "slots"}`}
              </span>
            </div>
            {queued > 0 && (
              <div className="queue-bar">
                {Array.from({ length: Math.min(queued, 16) }, (_, i) => (
                  <i key={i} />
                ))}
              </div>
            )}
          </>
        )}
        {role === "balancer" && (
          <>
            <div className="node-code">
              {config.balancer.policy === "round-robin"
                ? "Round robin"
                : "Least connections"}
            </div>
            <div className="node-detail">
              <span>Healthy targets</span>
              <strong>
                {targets.filter((t) => t.online).length} / {targets.length}
              </strong>
            </div>
            <div className="node-footer">
              <span>
                {targets.reduce((sum, t) => sum + t.assigned, 0)} routed
              </span>
              <span>
                {config.balancer.online ? "● Available" : "● Offline"}
              </span>
            </div>
          </>
        )}
        {role === "cache" && (
          <>
            <div className="node-detail">
              <span>Entries</span>
              <strong>
                {state.entries.length}{" "}
                <em>
                  {config.cache.technology === "generic"
                    ? `/ ${config.capacity}`
                    : "keys"}
                </em>
              </strong>
            </div>
            {state.entries.length ? (
              state.entries.slice(0, 2).map((e) => (
                <div className="cache-entry" key={e.key}>
                  <code>{e.key}</code>
                  <span>
                    <Clock3 size={10} />{" "}
                    {Number.isFinite(e.expires)
                      ? `${Math.max(0, Math.ceil((e.expires - state.now) / 1000))}s`
                      : "Persistent"}
                  </span>
                </div>
              ))
            ) : (
              <div className="empty-cache">No entries yet</div>
            )}
            <div className="node-footer">
              <span>
                <i className="tiny-dot" /> {state.hits} hits
              </span>
              <span>{state.misses} misses</span>
              <span>
                {config.cache.technology === "generic"
                  ? config.eviction
                  : config.cache.policy}
              </span>
            </div>
          </>
        )}
        {role === "producer" && (
          <>
            <div className="node-code">
              Key: {config.producer.key || "(empty)"}
            </div>
            <div className="node-detail">
              <span>Published</span>
              <strong>{state.kafka.produced + state.queueLab.published}</strong>
            </div>
            <div className="node-footer">Send a payload in Technology lab</div>
          </>
        )}
        {role === "stream" && (
          <>
            <div className="node-code">
              {config.kafka.topic} · {config.kafka.partitions} partitions
            </div>
            <div className="partition-mini">
              {state.kafka.partitions.map((p) => (
                <div key={p.id}>
                  <span>P{p.id}</span>
                  <b>{p.records.length}</b>
                  <small>offset {p.end}</small>
                </div>
              ))}
            </div>
            <div className="node-footer">
              <span>{state.kafka.produced} produced</span>
              <span>
                ISR {config.kafka.inSyncReplicas}/
                {config.kafka.replicationFactor}
              </span>
            </div>
          </>
        )}
        {role === "consumer" && (
          <>
            <div className="node-code">
              {consumerSettings(config, id).groupId}
            </div>
            <div className="node-detail">
              <span>Assigned partitions</span>
              <strong>
                {state.kafka.groups
                  .find((g) => g.id === consumerSettings(config, id).groupId)
                  ?.owners.filter((owner) => owner === id).length ?? 0}
              </strong>
            </div>
            <div className="node-footer">
              <span>
                {consumerSettings(config, id).autoCommit
                  ? "Auto commit"
                  : "Manual commit"}
              </span>
              <span>
                {state.kafka.deliveries.filter((d) => d.consumer === id).length}{" "}
                recent deliveries
              </span>
            </div>
          </>
        )}
        {role === "queue" && (
          <>
            <div className="node-detail">
              <span>Ready</span>
              <strong>
                {
                  state.queueLab.messages.filter((m) => m.state === "ready")
                    .length
                }
              </strong>
            </div>
            <div className="node-detail">
              <span>In flight</span>
              <strong>
                {
                  state.queueLab.messages.filter((m) =>
                    ["inflight", "unacked"].includes(m.state),
                  ).length
                }
              </strong>
            </div>
            <div className="node-footer">
              <span>
                {
                  state.queueLab.messages.filter((m) => m.state === "dead")
                    .length
                }{" "}
                dead letters
              </span>
              <span>{state.queueLab.redelivered} redeliveries</span>
            </div>
          </>
        )}
        {role === "worker" && (
          <>
            <div className="node-code">
              {workerSettings(config, id).fail
                ? "Fail deliveries"
                : "Process & acknowledge"}
            </div>
            <div className="node-detail">
              <span>In flight / limit</span>
              <strong>
                {state.queueLab.inProgress.filter((job) => job.worker === id)
                  .length +
                  state.queueLab.messages.filter(
                    (m) => m.worker === id && m.state === "unacked",
                  ).length}{" "}
                / {workerSettings(config, id).prefetch}
              </strong>
            </div>
            <div className="node-footer">
              <span>
                {workerSettings(config, id).processingMs} ms / message
              </span>
              <span>
                {workerSettings(config, id).ack === "manual"
                  ? "Manual ack"
                  : "Ack on success"}
              </span>
            </div>
          </>
        )}
        {role === "database" && (
          <>
            <div className="db-table">
              <span>▤ &nbsp; users</span>
              <span>{Object.keys(state.database.primary).length} records</span>
            </div>
            <div className="node-detail">
              <span>Total reads</span>
              <strong>{state.database.reads}</strong>
            </div>
            <div className="node-footer">
              <span className={!config.online ? "error-text" : ""}>
                {config.online ? "● Available" : "● Offline"}
              </span>
              <span>{config.delay} ms / read</span>
            </div>
          </>
        )}
      </div>
      {[
        "client",
        "backend",
        "balancer",
        "producer",
        "stream",
        "queue",
      ].includes(role) && <Handle type="source" position={Position.Right} />}
    </div>
  );
}
export function TrafficEdge(props: EdgeProps) {
  const [path, x, y] = getSmoothStepPath(props);
  const forward = Number(props.data?.forward ?? 0);
  const backward = Number(props.data?.backward ?? 0);
  const count = forward + backward;
  return (
    <>
      <BaseEdge
        id={props.id}
        path={path}
        style={props.style}
        markerEnd={props.markerEnd}
      />
      {props.label && (
        <EdgeLabelRenderer>
          <div
            className="edge-label"
            style={{
              transform: `translate(-50%, -50%) translate(${x}px,${y}px)`,
            }}
          >
            {props.label}
            {count > 1 && <span className="edge-volume">{count}</span>}
          </div>
        </EdgeLabelRenderer>
      )}
      {[
        { count: forward, reverse: false },
        { count: backward, reverse: true },
      ]
        .filter((direction) => direction.count > 0)
        .map((direction) => (
          <circle
            key={String(direction.reverse)}
            className="traffic-packet"
            r={direction.count > 1 ? 5 : 4}
            fill={direction.reverse ? "#8a9fba" : "#56885d"}
            stroke="white"
            strokeWidth="1.5"
            style={{
              offsetPath: `path("${path}")`,
              animationDirection: direction.reverse ? "reverse" : "normal",
              animationPlayState: props.data?.playing ? "running" : "paused",
            }}
          />
        ))}
    </>
  );
}

export function AutoFit({ structureKey }: { structureKey: string }) {
  const ready = useNodesInitialized();
  const { fitView } = useReactFlow();
  useEffect(() => {
    if (!ready) return;
    const frame = requestAnimationFrame(() => {
      void fitView({ padding: 0.16 });
    });
    return () => cancelAnimationFrame(frame);
  }, [ready, structureKey, fitView]);
  return null;
}
