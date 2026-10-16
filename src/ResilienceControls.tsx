import type { Dispatch, SetStateAction } from "react";
import {
  resilienceSettings,
  connectionSettings,
  type Config,
  type Snapshot,
} from "./engine";
import { Numeric, Option } from "./TechnologyInspector";
export function ResilienceControls({
  id,
  config,
  state,
  onConfig,
}: {
  id: string;
  config: Config;
  state: Snapshot;
  onConfig: Dispatch<SetStateAction<Config>>;
}) {
  const settings = resilienceSettings(config, id),
    circuit = state.circuits[id];
  const update = (patch: Partial<typeof settings>) =>
    onConfig((current) => ({
      ...current,
      resilienceOverrides: {
        ...current.resilienceOverrides,
        [id]: { ...current.resilienceOverrides[id], ...patch },
      },
    }));
  return (
    <section className="dependency-controls">
      <div className="section-divider" />
      <h3 className="inspector-subtitle">Database resilience</h3>
      <Numeric
        label="Database attempt timeout · ms"
        value={settings.attemptTimeout}
        onChange={(attemptTimeout) => update({ attemptTimeout })}
      />
      <Numeric
        label="Maximum retries after first attempt"
        value={settings.maxRetries}
        min={0}
        max={3}
        onChange={(maxRetries) => update({ maxRetries })}
      />
      {settings.maxRetries > 0 && (
        <>
          <Numeric
            label="Retry backoff · ms"
            value={settings.backoffMs}
            min={0}
            onChange={(backoffMs) => update({ backoffMs })}
          />
          <Option
            label="Backoff strategy"
            value={settings.backoff}
            choices={[
              ["fixed", "Fixed delay"],
              ["exponential", "Exponential delay"],
            ]}
            onChange={(backoff) =>
              update({ backoff: backoff as "fixed" | "exponential" })
            }
          />
        </>
      )}
      <label className="lab-toggle">
        <input
          type="checkbox"
          checked={settings.breaker}
          onChange={(e) => update({ breaker: e.target.checked })}
        />
        Enable database circuit breaker
      </label>
      {settings.breaker && (
        <>
          <Numeric
            label="Consecutive failures to open"
            value={settings.failureThreshold}
            max={100}
            onChange={(failureThreshold) => update({ failureThreshold })}
          />
          <Numeric
            label="Circuit cooldown · ms"
            value={settings.resetMs}
            onChange={(resetMs) => update({ resetMs })}
          />
        </>
      )}
      <div
        className={`circuit-readout ${settings.breaker ? (circuit?.state ?? "closed") : "disabled"}`}
      >
        <strong>
          {settings.breaker
            ? `Circuit ${circuit?.state ?? "closed"}`
            : "Circuit disabled"}
        </strong>
        <span>
          {circuit?.attempts ?? 0} attempts · {circuit?.retries ?? 0} retries ·{" "}
          {circuit?.blocked ?? 0} blocked
        </span>
        {settings.breaker && circuit?.state === "open" && (
          <small>
            Probe allowed after{" "}
            {Math.max(0, Math.ceil((circuit.openUntil - state.now) / 1000))}{" "}
            simulated seconds
          </small>
        )}
      </div>
      <p className="field-help">
        Transient database failures and attempt timeouts can retry. Every
        attempt and backoff shares the backend timeout. An open circuit rejects
        calls. After cooldown, one probe can test recovery. Cache hits bypass
        the circuit.
      </p>
      <a
        className="technology-reference"
        href="https://martinfowler.com/bliki/CircuitBreaker.html"
        target="_blank"
        rel="noreferrer"
      >
        Circuit breaker reference ↗
      </a>
    </section>
  );
}
export function ConnectionInspector({
  id,
  source,
  target,
  config,
  onConfig,
  onRemove,
}: {
  id: string;
  source: string;
  target: string;
  config: Config;
  onConfig: Dispatch<SetStateAction<Config>>;
  onRemove: () => void;
}) {
  const supported = /^backend(?:-[2-8])?-database$/.test(id),
    settings = connectionSettings(config, id);
  const update = (patch: Partial<typeof settings>) =>
    onConfig((current) => ({
      ...current,
      connectionOverrides: {
        ...current.connectionOverrides,
        [id]: { ...current.connectionOverrides[id], ...patch },
      },
    }));
  return (
    <aside className="inspector">
      <div className="panel-heading">
        <h2>Connection</h2>
      </div>
      <div className="inspector-scroll">
        <h3 className="connection-title">
          {source}
          <span>to</span>
          {target}
        </h3>
        <p className="field-help">
          Requests follow this connection. Responses travel back along it.
        </p>
        {supported ? (
          <>
            <label className="lab-toggle">
              <input
                type="checkbox"
                checked={settings.online}
                onChange={(e) => update({ online: e.target.checked })}
              />
              Connection online
            </label>
            <Numeric
              label="Latency per direction · ms"
              value={settings.latency}
              min={0}
              onChange={(latency) => update({ latency })}
            />
            <Numeric
              label="Fail every Nth attempt · 0 disables"
              value={settings.failureEvery}
              min={0}
              max={100}
              onChange={(failureEvery) => update({ failureEvery })}
            />
            <p className="field-help">
              Latency affects the request and response. Periodic failures count
              actual database attempts, including retries. Select the backend to
              configure retries and its circuit breaker.
            </p>
          </>
        ) : (
          <p className="field-help">
            Fault controls apply to backend-to-database connections. Select a
            database connection to introduce latency or failures.
          </p>
        )}
        <button className="secondary-button" onClick={onRemove}>
          Remove connection
        </button>
      </div>
    </aside>
  );
}
