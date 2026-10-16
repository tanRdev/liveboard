import { useState, type Dispatch, type SetStateAction } from "react";
import type { Board } from "./board";
import {
  experimentDefaults,
  sameWorkload,
  configFingerprint,
  type ExperimentSpec,
  type ExperimentReport,
} from "./experiments";
import {
  briefs,
  checkpoints,
  estimateCapacity,
  type InterviewBrief,
  type CapacityInput,
} from "./interview";
import { Numeric, Option } from "./TechnologyInspector";
import { createReportHtml } from "./report";
export type RecordedRun = {
  id: string;
  board: Board;
  report: ExperimentReport;
};
export type ExperimentStatus = {
  running: boolean;
  progress: number;
  error: string;
};
type Props = {
  brief: InterviewBrief;
  onBrief: Dispatch<SetStateAction<InterviewBrief>>;
  onLoadBrief: (id: string) => void;
  clock: {
    remaining: number;
    running: boolean;
    toggle: () => void;
    reset: (minutes?: number) => void;
  };
  status: ExperimentStatus;
  runs: RecordedRun[];
  onRun: (spec: ExperimentSpec) => void;
  onCancel: () => void;
  path: string;
  currentConfig: Board["config"];
};
function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type })),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function BriefPanel({
  brief,
  onBrief,
  onLoadBrief,
}: Pick<Props, "brief" | "onBrief" | "onLoadBrief">) {
  const completed = new Set(brief.checklist);
  const update = (patch: Partial<InterviewBrief>) =>
    onBrief((current) => ({ ...current, ...patch }));
  return (
    <div className="interview-columns">
      <section>
        <div className="brief-presets">
          {briefs.map((item) => (
            <button key={item.id} onClick={() => onLoadBrief(item.id)}>
              {item.name}
              <span>Start brief & board</span>
            </button>
          ))}
        </div>
        <label className="interview-field">
          Problem statement
          <textarea
            aria-label="Problem statement"
            maxLength={12000}
            value={brief.prompt}
            onChange={(e) => update({ prompt: e.target.value })}
          />
        </label>
        <label className="interview-field">
          Requirements and constraints
          <textarea
            aria-label="Requirements and constraints"
            maxLength={12000}
            value={brief.requirements}
            onChange={(e) => update({ requirements: e.target.value })}
          />
        </label>
        <div className="target-fields">
          <label className="lab-field">
            <span>Target success · percent</span>
            <input
              className="field"
              aria-label="Target success · percent"
              type="number"
              step="0.01"
              min="0"
              max="100"
              value={brief.targetSuccess}
              onChange={(e) => {
                const value = e.currentTarget.valueAsNumber;
                if (Number.isFinite(value))
                  update({ targetSuccess: Math.max(0, Math.min(100, value)) });
              }}
            />
          </label>
          <Numeric
            label="Target successful P95 · ms"
            value={brief.targetP95}
            onChange={(targetP95) => update({ targetP95 })}
          />
          <Numeric
            label="Interview duration · minutes"
            min={5}
            max={180}
            value={brief.minutes}
            onChange={(minutes) => update({ minutes })}
          />
        </div>
      </section>
      <section>
        <label className="interview-field">
          Assumptions
          <textarea
            aria-label="Design assumptions"
            placeholder="Traffic shape, data size, consistency, failure tolerance…"
            maxLength={12000}
            value={brief.assumptions}
            onChange={(e) => update({ assumptions: e.target.value })}
          />
        </label>
        <label className="interview-field">
          Decisions and trade-offs
          <textarea
            aria-label="Design decisions and trade-offs"
            placeholder="What did you choose, why, and when would you change it?"
            maxLength={12000}
            value={brief.decisions}
            onChange={(e) => update({ decisions: e.target.value })}
          />
        </label>
        <div className="interview-checklist">
          {checkpoints.map((item) => (
            <label key={item}>
              <input
                type="checkbox"
                checked={completed.has(item)}
                onChange={(e) =>
                  onBrief((current) => ({
                    ...current,
                    checklist: e.target.checked
                      ? [...current.checklist, item]
                      : current.checklist.filter((v) => v !== item),
                  }))
                }
              />
              {item}
            </label>
          ))}
        </div>
        <p className="field-help">
          Save the board to keep your brief, estimates, assumptions, and
          decisions. Checkpoints record your progress.
        </p>
      </section>
    </div>
  );
}
function CapacityPanel({ brief, onBrief }: Pick<Props, "brief" | "onBrief">) {
  const input = brief.capacity,
    result = estimateCapacity(input);
  const change = (key: keyof CapacityInput, value: number) =>
    onBrief((current) => ({
      ...current,
      capacity: { ...current.capacity, [key]: value },
    }));
  const fields: [keyof CapacityInput, string, number, number][] = [
    ["dailyRequests", "Requests per day", 0, 1e12],
    ["peakFactor", "Peak multiplier", 1, 100],
    ["readPercent", "Read operations · percent", 0, 100],
    ["responseBytes", "Average response · bytes", 0, 1e9],
    ["writesPerDay", "New records per day", 0, 1e12],
    ["recordBytes", "Average stored record · bytes", 0, 1e9],
    ["retentionDays", "Retention · days", 1, 36500],
    ["replicas", "Stored copies", 1, 100],
  ];
  return (
    <div className="interview-columns">
      <section>
        <h3>Make the assumptions explicit</h3>
        <div className="capacity-fields">
          {fields.map(([key, label, min, max]) => (
            <Numeric
              key={key}
              label={label}
              min={min}
              max={max}
              value={input[key]}
              onChange={(value) => change(key, value)}
            />
          ))}
        </div>
      </section>
      <section>
        <h3>Capacity worksheet</h3>
        <div className="capacity-results">
          {[
            ["Average requests/s", result.averageRps.toFixed(2)],
            ["Peak requests/s", result.peakRps.toFixed(2)],
            ["Peak reads/s", result.readRps.toFixed(2)],
            ["Peak writes/s", result.writeRps.toFixed(2)],
            [
              "Peak response bandwidth",
              `${(result.egressBytesPerSecond / 1e6).toFixed(2)} MB/s`,
            ],
            [
              "Logical retained records",
              `${(result.logicalStorageBytes / 1e9).toFixed(2)} GB`,
            ],
            [
              "Storage with copies",
              `${(result.replicatedStorageBytes / 1e9).toFixed(2)} GB`,
            ],
          ].map(([label, value]) => (
            <div key={label}>
              <span>{label}</span>
              <b>{value}</b>
            </div>
          ))}
        </div>
        <details className="capacity-formulas">
          <summary>Show the arithmetic</summary>
          <code>
            Average RPS = requests per day / 86,400
            <br />
            Peak RPS = average RPS × peak multiplier
            <br />
            Response bytes/s = peak RPS × response bytes
            <br />
            Logical bytes = new records/day × record bytes × retention days
            <br />
            Stored bytes = logical bytes × stored copies
          </code>
        </details>
        <p className="field-help">
          Storage counts record payloads. Bandwidth counts response payloads.
          Use these estimates to discuss indexes, metadata, compression, and
          protocol overhead separately.
        </p>
      </section>
    </div>
  );
}
function ExperimentForm({
  brief,
  status,
  onRun,
  onCancel,
  path,
}: Pick<Props, "brief" | "status" | "onRun" | "onCancel" | "path">) {
  const [spec, setSpec] = useState<ExperimentSpec>({
    ...experimentDefaults,
    path,
  });
  const patch = (value: Partial<ExperimentSpec>) =>
    setSpec((current) => ({ ...current, ...value }));
  return (
    <form
      className="experiment-form"
      onSubmit={(e) => {
        e.preventDefault();
        onRun({
          ...spec,
          targetSuccess: brief.targetSuccess,
          targetP95: brief.targetP95,
        });
      }}
    >
      <label className="interview-field">
        Run name
        <input
          aria-label="Experiment name"
          maxLength={200}
          value={spec.name}
          onChange={(e) => patch({ name: e.target.value })}
        />
      </label>
      <label className="interview-field">
        GET path
        <input
          aria-label="Experiment request path"
          maxLength={200}
          value={spec.path}
          onChange={(e) => patch({ path: e.target.value })}
        />
      </label>
      <div className="experiment-fields">
        <Numeric
          label="Experiment requests / second"
          value={spec.rate}
          max={100}
          onChange={(rate) => patch({ rate })}
        />
        <Numeric
          label="Arrival duration · seconds"
          value={spec.seconds}
          max={60}
          onChange={(seconds) => patch({ seconds })}
        />
        <Option
          label="Traffic pattern"
          value={spec.pattern}
          choices={[
            ["hot-key", "One hot key"],
            ["round-robin", "Rotate seeded record IDs"],
          ]}
          onChange={(pattern) =>
            patch({ pattern: pattern as ExperimentSpec["pattern"] })
          }
        />
        <Numeric
          label="Maximum record IDs"
          value={spec.keys}
          max={100}
          onChange={(keys) => patch({ keys })}
        />
        <Option
          label="Cache start"
          value={spec.cacheStart}
          choices={[
            ["cold", "Cold start"],
            ["warm", "Attempt cache warm-up"],
          ]}
          onChange={(cacheStart) =>
            patch({ cacheStart: cacheStart as ExperimentSpec["cacheStart"] })
          }
        />
        <Option
          label="Scheduled failure"
          value={spec.fault}
          choices={[
            ["none", "None"],
            ["database-outage", "Database outage"],
            ["cache-outage", "Cache outage"],
            ["backend-outage", "First backend outage"],
            ["cache-flush", "Flush cache once"],
          ]}
          onChange={(fault) =>
            patch({ fault: fault as ExperimentSpec["fault"] })
          }
        />
        {spec.fault !== "none" && (
          <>
            <Numeric
              label="Failure at · seconds"
              value={spec.faultAt}
              min={0}
              max={60}
              onChange={(faultAt) => patch({ faultAt })}
            />
            {spec.fault !== "cache-flush" && (
              <Numeric
                label="Recovery at · seconds"
                value={spec.recoverAt}
                min={0}
                max={60}
                onChange={(recoverAt) => patch({ recoverAt })}
              />
            )}
          </>
        )}
      </div>
      <div className="experiment-actions">
        <button className="save-button" type="submit" disabled={status.running}>
          {status.running
            ? `Running · ${Math.round(status.progress)}%`
            : "Run experiment"}
        </button>
        {status.running && (
          <button type="button" className="plain-button" onClick={onCancel}>
            Cancel experiment
          </button>
        )}
      </div>
      {status.error && (
        <p className="experiment-error" role="alert">
          {status.error}
        </p>
      )}
      <p className="field-help">
        Each run starts a separate simulation with the board's seed records and
        captured settings. The live board stays available. Arrivals stop at the
        duration. Accepted requests can drain for up to 60 simulated seconds.
      </p>
    </form>
  );
}
function QueueChart({
  run,
  baseline,
}: {
  run: ExperimentReport;
  baseline?: ExperimentReport;
}) {
  const max = Math.max(
      1,
      ...run.series.map((p) => p.queued),
      ...(baseline?.series.map((p) => p.queued) ?? []),
    ),
    seconds = Math.max(run.spec.seconds, baseline?.spec.seconds ?? 0);
  const line = (report: ExperimentReport) =>
    report.series
      .map(
        (p) =>
          `${35 + (p.second / seconds) * 465},${110 - (p.queued / max) * 90}`,
      )
      .join(" ");
  return (
    <div className="experiment-chart">
      <span>Waiting requests over simulated time</span>
      <svg
        viewBox="0 0 520 140"
        role="img"
        aria-label="Experiment queue comparison"
      >
        <line x1="35" y1="110" x2="500" y2="110" stroke="#dce4d5" />
        <line x1="35" y1="20" x2="35" y2="110" stroke="#dce4d5" />
        <text x="5" y="25">
          {max}
        </text>
        <text x="15" y="114">
          0
        </text>
        <text x="35" y="132">
          0s
        </text>
        <text x="475" y="132">
          {seconds}s
        </text>
        {baseline && (
          <polyline
            points={line(baseline)}
            fill="none"
            stroke="#a6abbc"
            strokeWidth="2"
          />
        )}
        <polyline
          points={line(run)}
          fill="none"
          stroke="#5c8754"
          strokeWidth="2.5"
        />
        {run.timeline.map((event) => (
          <line
            key={`${event.second}-${event.text}`}
            x1={35 + (event.second / seconds) * 465}
            y1="20"
            x2={35 + (event.second / seconds) * 465}
            y2="110"
            stroke="#bc8864"
            strokeDasharray="3 4"
          >
            <title>
              {event.second}s: {event.text}
            </title>
          </line>
        ))}
      </svg>
      <small>
        Green: selected run · gray: baseline · dashed: failure changes
      </small>
    </div>
  );
}
function ExperimentResults({
  runs,
  brief,
  currentConfig,
}: Pick<Props, "runs" | "brief" | "currentConfig">) {
  const [selected, setSelected] = useState(""),
    [baselineId, setBaselineId] = useState("");
  const run = runs.find((r) => r.id === selected) ?? runs.at(-1),
    baseline = runs.find((r) => r.id === baselineId) ?? runs[0];
  if (!run)
    return (
      <div className="interview-empty">
        <b>Measure before changing the design.</b>
        <p>
          Run a baseline. Change one setting. Run the same workload again to
          compare success, latency, queueing, and database load.
        </p>
      </div>
    );
  const exportBrief =
    run.board.interview && run.board.interview.prompt !== brief.prompt
      ? run.board.interview
      : brief;
  const report = run.report,
    comparable =
      baseline &&
      baseline.id !== run.id &&
      sameWorkload(report.spec, baseline.report.spec);
  return (
    <div className="experiment-results">
      <p className="field-help">
        Last four runs in this session. Download a report to retain the
        evidence.
      </p>
      <table className="experiment-table">
        <thead>
          <tr>
            {["Baseline", "Run", "Success", "P95", "Reads", "Targets"].map(
              (label) => (
                <th key={label}>{label}</th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {runs.map((item) => (
            <tr key={item.id} className={item.id === run.id ? "selected" : ""}>
              <td>
                <input
                  aria-label={`Use ${item.report.spec.name} as baseline`}
                  type="radio"
                  name="baseline-run"
                  checked={item.id === baseline?.id}
                  onChange={() => setBaselineId(item.id)}
                />
              </td>
              <td>
                <button onClick={() => setSelected(item.id)}>
                  {item.report.spec.name}
                </button>
              </td>
              <td>{item.report.successPercent.toFixed(2)}%</td>
              <td>{item.report.success > 0 ? `${item.report.p95} ms` : "—"}</td>
              <td>{item.report.reads}</td>
              <td
                className={item.report.passed ? "targets-pass" : "targets-fail"}
              >
                {item.report.passed ? "Met" : "Missed"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="experiment-summary">
        <span>{report.offered} offered</span>
        <span>{report.success} successful</span>
        <span>{report.failed} failed</span>
        <span>{report.pending} pending</span>
        <span>{report.retries} retries</span>
        <span>{report.blocked} circuit rejections</span>
      </div>
      {comparable && (
        <p className="comparison-delta">
          Compared with {baseline.report.spec.name}:{" "}
          {(report.successPercent - baseline.report.successPercent).toFixed(2)}{" "}
          percentage points success ·{" "}
          {report.success > 0 && baseline.report.success > 0
            ? `${report.p95 - baseline.report.p95} ms P95`
            : "P95 needs successful responses in both runs"}{" "}
          · {report.reads - baseline.report.reads} database reads.
        </p>
      )}
      {baseline && baseline.id !== run.id && !comparable && (
        <p className="field-help">
          These runs use different workloads. Use identical arrival and failure
          settings to isolate a design change.
        </p>
      )}
      <QueueChart
        run={report}
        baseline={comparable ? baseline.report : undefined}
      />
      <div className="experiment-actions">
        <button
          className="secondary-button"
          onClick={() =>
            download(
              "liveboard-interview-report.html",
              createReportHtml(run.board, report, exportBrief),
              "text/html",
            )
          }
        >
          Download interview report
        </button>
        <button
          className="text-button"
          onClick={() =>
            download(
              "liveboard-experiment.json",
              JSON.stringify(
                {
                  format: "liveboard-experiment-v1",
                  board: run.board,
                  report,
                  interview: brief,
                },
                null,
                2,
              ),
              "application/json",
            )
          }
        >
          Evidence JSON
        </button>
      </div>
      <p className="field-help">
        Measured board: {run.board.title}. Configuration {report.fingerprint}.
      </p>
      <p className="field-help">
        P95 includes every successful response, including the drain. Pending
        requests count against success. Targets for this run:{" "}
        {report.spec.targetSuccess}% success and {report.spec.targetP95} ms P95.{" "}
        {report.fingerprint === configFingerprint(currentConfig)
          ? "Current settings match this run."
          : "The current configuration differs from this measured run."}
      </p>
      <details>
        <summary>Inspect failure timeline and request evidence</summary>
        <div className="experiment-evidence">
          {report.timeline.map((event) => (
            <p key={`${event.second}-${event.text}`}>
              {event.second}s · {event.text}
            </p>
          ))}
          {report.examples.map((example) => (
            <details key={example.id}>
              <summary>
                Request #{example.id} · HTTP {example.status} ·{" "}
                {example.duration} ms
              </summary>
              {example.trace.map((event) => (
                <div key={event.id}>
                  <code>{(event.time / 1000).toFixed(3)}s</code>
                  <b>{event.component}</b>
                  <span>{event.text}</span>
                </div>
              ))}
            </details>
          ))}
        </div>
      </details>
    </div>
  );
}
export default function InterviewPanel(props: Props) {
  const [tab, setTab] = useState("Brief");
  const minutes = Math.floor(props.clock.remaining / 60000),
    seconds = Math.floor(props.clock.remaining / 1000) % 60;
  return (
    <div className="interview-panel">
      <header className="interview-heading">
        <div>
          <b>Interview workspace</b>
          <span>
            State your assumptions. Test the design. Explain the result.
          </span>
        </div>
        <div
          className={`interview-clock ${props.clock.remaining === 0 ? "expired" : ""}`}
        >
          <span>Real time</span>
          <strong>
            {minutes.toString().padStart(2, "0")}:
            {seconds.toString().padStart(2, "0")}
          </strong>
          <button onClick={props.clock.toggle}>
            {props.clock.running ? "Pause timer" : "Start timer"}
          </button>
          <button onClick={() => props.clock.reset()}>Reset timer</button>
        </div>
      </header>
      <nav className="interview-tabs" aria-label="Interview sections">
        {["Brief", "Capacity", "Experiments"].map((name) => (
          <button
            className={tab === name ? "active" : ""}
            key={name}
            onClick={() => setTab(name)}
          >
            {name}
            {name === "Experiments" && props.runs.length > 0
              ? ` · ${props.runs.length}`
              : ""}
          </button>
        ))}
      </nav>
      {tab === "Brief" && <BriefPanel {...props} />}{" "}
      {tab === "Capacity" && <CapacityPanel {...props} />}{" "}
      {tab === "Experiments" && (
        <div className="experiment-layout">
          <ExperimentForm {...props} />
          <ExperimentResults {...props} />
        </div>
      )}
    </div>
  );
}
