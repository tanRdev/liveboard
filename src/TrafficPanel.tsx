import { useState } from "react";
import { ArrowUpRight, Play, Square, Activity } from "lucide-react";
import type { Config, Snapshot } from "./engine";

type Props = {
  state: Snapshot;
  config: Config;
  path: string;
  paused: boolean;
  onTraffic: (rate: number, path: string, running: boolean) => void;
  onConfigure: () => void;
};

export default function TrafficPanel({
  state,
  config,
  path,
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
  const queued = Math.min(
    100,
    (state.queue / Math.max(1, config.queueLimit)) * 100,
  );
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
          <span>In flight</span>
          <strong>
            {state.activeCount}
            <small> / {config.concurrency}</small>
          </strong>
        </div>
        <div>
          <span>Waiting</span>
          <strong>
            {state.queue}
            <small> / {config.queueLimit}</small>
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
        <span>Full queues reject new requests.</span>
      </div>
    </div>
  );
}
