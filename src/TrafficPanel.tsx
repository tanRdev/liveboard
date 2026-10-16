import { useState } from "react";
import { ArrowUpRight, Play, Square, Activity } from "lucide-react";
import type { Snapshot } from "./engine";

type Props = {
  state: Snapshot;
  path: string;
  dependencies: string[];
  paused: boolean;
  onTraffic: (rate: number, path: string, running: boolean) => void;
  onConfigure: () => void;
};

export default function TrafficPanel({
  state,
  path,
  dependencies,
  paused,
  onTraffic,
  onConfigure,
}: Props) {
  const [rate, setRate] = useState(state.traffic.rate);
  const { metrics, traffic } = state;
  const average = metrics.completed
    ? Math.round(metrics.totalDuration / metrics.completed)
    : 0;
  const failureRate = metrics.completed
    ? Math.round((metrics.failed / metrics.completed) * 100)
    : 0;
  const targets = Object.entries(state.backends);
  const dependencyIds = new Set(dependencies);
  const reachable = targets.filter(
    ([id, backend]) =>
      backend.online && (backend.reachable || dependencyIds.has(id)),
  );
  const concurrency = reachable.reduce(
    (sum, [, backend]) => sum + backend.concurrency,
    0,
  );
  const queueLimit = reachable.reduce(
    (sum, [, backend]) => sum + backend.queueLimit,
    0,
  );
  const samples = state.results
    .map((result) => result.duration)
    .sort((a, b) => a - b);
  const p95 = samples[Math.max(0, Math.ceil(samples.length * 0.95) - 1)] ?? 0;
  const queued = Math.min(100, (state.queue / Math.max(1, queueLimit)) * 100);
  return (
    <div className="traffic-panel">
      <div className="traffic-controls">
        <Activity size={17} />
        <label htmlFor="traffic-rate">
          Traffic rate <strong>{rate} req/s</strong>
        </label>
        <input
          id="traffic-rate"
          aria-label="Requests per simulated second"
          type="range"
          min="1"
          max="20"
          value={rate}
          onChange={(event) => {
            const value = Number(event.target.value);
            setRate(value);
            if (traffic.running) onTraffic(value, traffic.path, true);
          }}
        />
        <button
          className={traffic.running ? "stop-traffic" : "send-button"}
          onClick={() => onTraffic(rate, path, !traffic.running)}
        >
          {traffic.running ? (
            <Square size={11} fill="currentColor" />
          ) : (
            <Play size={11} fill="currentColor" />
          )}
          {traffic.running ? "Stop traffic" : "Start traffic"}
        </button>
      </div>
      <div className="traffic-context">
        <code>GET {traffic.running ? traffic.path : path}</code>
        <span>
          {traffic.running
            ? paused
              ? "Paused with simulated time"
              : "Generating requests in simulated time"
            : state.active
              ? "Traffic stopped. Accepted requests are draining."
              : "Set a rate, then start the experiment."}
        </span>
        <button onClick={onConfigure}>
          Backend settings <ArrowUpRight size={12} />
        </button>
      </div>
      <div className="traffic-metrics">
        <div>
          <span>Active service work</span>
          <strong>
            {state.activeCount}
            <small> / {concurrency}</small>
          </strong>
        </div>
        <div>
          <span>Waiting work</span>
          <strong>
            {state.queue}
            <small> / {queueLimit}</small>
          </strong>
          <div className="traffic-meter">
            <i style={{ width: `${queued}%` }} />
          </div>
        </div>
        <div>
          <span>Avg response · simulated</span>
          <strong>
            {average}
            <small> ms</small>
          </strong>
        </div>
        <div>
          <span>Failed responses</span>
          <strong className={metrics.failed ? "error-text" : ""}>
            {failureRate}
            <small>%</small>
          </strong>
        </div>
      </div>
      <div className="traffic-totals">
        <span>{metrics.sent} sent</span>
        <span>{metrics.completed} responses</span>
        <span>{metrics.rejected} rejected · 429</span>
        <span>Peak queue {state.peakQueue}</span>
        <span>Each service has its own slots and queue.</span>
      </div>
      <div className="distribution-heading">
        <span>BACKEND DISTRIBUTION</span>
        <span>
          P95 {p95} ms · last {samples.length} responses · simulated
        </span>
      </div>
      <div className="distribution-table">
        <div className="distribution-columns">
          <span>INSTANCE</span>
          <span>ASSIGNED</span>
          <span>ACTIVE</span>
          <span>WAITING</span>
          <span>FAILED</span>
        </div>
        {targets.map(([id, backend]) => (
          <div className="distribution-row" key={id}>
            <span>
              <i
                className={`status-dot ${backend.online && (backend.reachable || dependencyIds.has(id)) ? "" : "offline"}`}
              />
              <strong>{backend.name}</strong>
              <small>
                {backend.online
                  ? backend.reachable
                    ? ""
                    : dependencyIds.has(id)
                      ? "service dependency"
                      : "not routed"
                  : "offline"}
              </small>
            </span>
            <span>
              <span className="distribution-track">
                <i
                  style={{
                    width: `${state.metrics.sent ? (backend.assigned / state.metrics.sent) * 100 : 0}%`,
                  }}
                />
              </span>
              {backend.assigned}
            </span>
            <span>
              {backend.active} / {backend.concurrency}
            </span>
            <span>{backend.queued}</span>
            <span className={backend.failed ? "error-text" : ""}>
              {backend.failed}
            </span>
          </div>
        ))}
        {!targets.length && (
          <p className="field-help">
            Add a backend instance to observe routing.
          </p>
        )}
      </div>
    </div>
  );
}
