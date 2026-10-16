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
  resilienceSettings,
  consumerSettings,
  workerSettings,
  type Config,
  type Role,
  type Snapshot,
} from "../simulation/engine";
import { icons } from "./visuals";
import { serviceSettings } from "../simulation/services";
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
                <span className="tiny-dot" />{" "}
                {serviceSettings(config, id).mode === "handler"
                  ? `${serviceSettings(config, id).calls} calls${serviceSettings(config, id).publish === "none" ? "" : " · publish"}`
                  : "Cache-aside"}
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
            {(resilienceSettings(config, id).breaker ||
              resilienceSettings(config, id).maxRetries > 0) && (
              <div
                className={`backend-circuit ${state.circuits[id]?.state ?? "closed"}`}
              >
                <span>
                  {resilienceSettings(config, id).breaker
                    ? `Circuit ${state.circuits[id]?.state ?? "closed"}`
                    : "Retries enabled"}
                </span>
                <span>{state.circuits[id]?.retries ?? 0} retries</span>
              </div>
            )}
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
function trafficAppearance(forward: number, backward: number) {
  const direction =
    forward && backward ? "both" : backward ? "response" : "request";
  const color = { both: "#7c3aed", response: "#0284c7", request: "#e8790c" }[
    direction
  ];
  return { direction, color };
}

export function TrafficEdge(props: EdgeProps) {
  const [path, x, y] = getSmoothStepPath(props);
  const forward = Number(props.data?.forward ?? 0);
  const backward = Number(props.data?.backward ?? 0);
  const count = forward + backward;
  const { color, direction } = trafficAppearance(forward, backward);
  const directionStyle = {
    ...props.style,
    ...(count ? { stroke: color, strokeWidth: 3 } : {}),
  };
  return (
    <>
      <BaseEdge
        id={props.id}
        path={path}
        style={directionStyle}
        markerEnd={count ? undefined : props.markerEnd}
      />
      {count > 0 && (
        <path
          className="traffic-glow"
          d={path}
          fill="none"
          stroke={color}
          strokeWidth={12}
          opacity={0.12}
        />
      )}
      {props.label && (
        <EdgeLabelRenderer>
          <div
            className={`edge-label ${count ? "edge-label-active" : ""}`}
            data-direction={direction}
            style={{
              transform: `translate(-50%, -50%) translate(${x}px,${y}px)`,
            }}
          >
            {props.label}
            {count > 1 && <span className="edge-volume">{count}</span>}
          </div>
        </EdgeLabelRenderer>
      )}
      <TrafficPackets
        path={path}
        count={forward}
        reverse={false}
        playing={Boolean(props.data?.playing)}
      />
      <TrafficPackets
        path={path}
        count={backward}
        reverse={true}
        playing={Boolean(props.data?.playing)}
      />
    </>
  );
}

function TrafficPackets({
  path,
  count,
  reverse,
  playing,
}: {
  path: string;
  count: number;
  reverse: boolean;
  playing: boolean;
}) {
  const color = reverse ? "#0284c7" : "#e8790c";
  return Array.from({ length: Math.min(count, 3) }, (_, index) => {
    const motion = {
      offsetPath: `path("${path}")`,
      animationDirection: reverse ? "reverse" : "normal",
      animationDelay: `${index * -0.16}s`,
      animationPlayState: playing ? "running" : "paused",
    };
    return (
      <g key={index}>
        <circle
          className="traffic-packet traffic-halo"
          r={8}
          fill={color}
          opacity={0.18}
          style={motion}
        />
        <path
          className="traffic-packet traffic-arrow"
          d="M -6,-5 L 5,0 L -6,5 L -3,0 Z"
          fill={color}
          stroke="white"
          strokeWidth={1.2}
          style={{ ...motion, offsetRotate: reverse ? "auto 180deg" : "auto" }}
        />
      </g>
    );
  });
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
