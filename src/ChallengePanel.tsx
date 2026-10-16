import { type Dispatch, type SetStateAction } from "react";
import { challengeCatalog } from "./challengeCatalog";
import {
  checkConstraints,
  createChallenge,
  definitionHash,
  parseChallenge,
  protectedFields,
  protectionLabels,
  type ChallengeDefinition,
  type ChallengeReport,
  type ChallengeTest,
  type Check,
} from "./challenges";
import {
  executionConfig,
  parseBoard,
  serializeBoard,
  type Board,
} from "./board";
import { configFingerprint, experimentDefaults } from "./experiments";
import { createChallengeReportHtml } from "./challengeReport";
import { Numeric, Option } from "./TechnologyInspector";
import type { ChallengeProgress, ChallengeStatus } from "./useChallengeSession";
type Props = {
  board: Board;
  active?: ChallengeDefinition;
  draft?: ChallengeDefinition;
  onDraft: Dispatch<SetStateAction<ChallengeDefinition | undefined>>;
  view: "gallery" | "play" | "author";
  onView: (view: "gallery" | "play" | "author") => void;
  report?: ChallengeReport;
  baseline?: ChallengeReport;
  status: ChallengeStatus;
  progress: Record<string, ChallengeProgress>;
  hints: number;
  onHint: () => void;
  attempts: number;
  onOpen: (definition: ChallengeDefinition) => void;
  onVerify: (
    definition: ChallengeDefinition,
    board: Board,
    options?: { baseline?: boolean; author?: boolean },
  ) => void;
  onCancel: () => void;
  onToast: (text: string) => void;
};
function download(name: string, value: unknown) {
  const url = URL.createObjectURL(
      new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
    ),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function CheckList({ checks }: { checks: Check[] }) {
  return (
    <div className="challenge-checks">
      {checks.map((check) => (
        <div
          key={check.id}
          className={check.passed ? "check-pass" : "check-fail"}
        >
          <span className="check-status">{check.passed ? "✓" : "×"}</span>
          <span>{check.label}</span>
          <b>{check.actual}</b>
          <small>{check.expected}</small>
        </div>
      ))}
    </div>
  );
}
function TestEvidence({
  report,
  baseline,
}: {
  report: ChallengeReport;
  baseline?: ChallengeReport;
}) {
  const starters = new Map(
    baseline?.tests.map((test) => [test.id, test.report]),
  );
  return (
    <div className="challenge-test-results">
      {report.tests.map((test) => {
        const starter = starters.get(test.id);
        return (
          <details key={test.id} open={!test.passed}>
            <summary>
              <strong className={test.passed ? "targets-pass" : "targets-fail"}>
                {test.passed ? "Passed" : "Needs work"}
              </strong>
              {test.label}
              <span>
                {test.report.successPercent.toFixed(2)}% success ·{" "}
                {test.report.success
                  ? `${Math.round(test.report.p95)} ms P95`
                  : "No successful latency samples"}
              </span>
            </summary>
            <CheckList checks={test.checks} />
            {starter && (
              <p className="field-help">
                Starter: {starter.successPercent.toFixed(2)}% success,{" "}
                {starter.success
                  ? `${Math.round(starter.p95)} ms P95`
                  : "no successful latency samples"}
                .
              </p>
            )}
            <details className="challenge-traces">
              <summary>Request evidence</summary>
              {test.report.examples.map((example) => (
                <details key={example.id}>
                  <summary>
                    Request #{example.id} · HTTP {example.status} ·{" "}
                    {Math.round(example.duration)} ms
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
            </details>
          </details>
        );
      })}
    </div>
  );
}
function Gallery({
  progress,
  onOpen,
  onCreate,
}: {
  progress: Props["progress"];
  onOpen: Props["onOpen"];
  onCreate: () => void;
}) {
  const solved = challengeCatalog.filter(
    (c) => (progress[c.id]?.stars ?? 0) > 0,
  ).length;
  return (
    <section className="challenge-gallery">
      <div className="challenge-intro">
        <div>
          <h3>Fix the incident.</h3>
          <p>
            Start with a broken system. Diagnose it. Meet the traffic objectives
            within a resource budget.
          </p>
        </div>
        <span>
          {solved} / {challengeCatalog.length} resolved
        </span>
      </div>
      <div className="challenge-cards">
        {challengeCatalog.map((challenge, index) => (
          <article key={challenge.id}>
            <div className="challenge-card-meta">
              <span>INCIDENT {String(index + 1).padStart(2, "0")}</span>
              <small>{challenge.difficulty}</small>
            </div>
            <h3>{challenge.title}</h3>
            <p>{challenge.problem}</p>
            <div className="challenge-card-budget">
              <span>{challenge.rules.maxSlots} slot budget</span>
              <span>{challenge.tests.length} traffic tests</span>
            </div>
            <div className="challenge-card-action">
              <button onClick={() => onOpen(challenge)}>
                {progress[challenge.id]?.stars
                  ? "Replay incident"
                  : "Start incident"}
              </button>
              <span
                aria-label={`${progress[challenge.id]?.stars ?? 0} of 3 stars`}
              >
                {"★".repeat(progress[challenge.id]?.stars ?? 0)}
                {"☆".repeat(3 - (progress[challenge.id]?.stars ?? 0))}
              </span>
            </div>
          </article>
        ))}
      </div>
      <div className="challenge-author-cta">
        <div>
          <b>Build an interview exercise</b>
          <p>
            Capture a starter board, define load tests and limits, then share a
            challenge file with a candidate.
          </p>
        </div>
        <button className="secondary-button" onClick={onCreate}>
          Create from current board
        </button>
      </div>
    </section>
  );
}
function Play(props: Props & { active: ChallengeDefinition }) {
  const { active, board, report, baseline, status } = props,
    liveChecks = checkConstraints(active, board),
    current =
      report?.fingerprint === configFingerprint(executionConfig(board)) &&
      report.definitionHash === definitionHash(active);
  const goals = active.tests.map((test) => (
    <div className="challenge-goal" key={test.id}>
      <strong>{test.label}</strong>
      <span>
        {test.spec.rate} req/s · {test.spec.seconds}s ·{" "}
        {test.spec.pattern === "hot-key"
          ? "one hot key"
          : `${test.spec.keys} rotating IDs`}
      </span>
      <small>
        Success ≥ {test.spec.targetSuccess}% · successful P95 ≤{" "}
        {test.spec.targetP95} ms
        {test.maxReads !== undefined ? ` · DB reads ≤ ${test.maxReads}` : ""}
        {test.minBlocked !== undefined
          ? ` · circuit rejections ≥ ${test.minBlocked}`
          : ""}
        {test.maxAttempts !== undefined
          ? ` · attempts ≤ ${test.maxAttempts}`
          : ""}
        {test.maxRetries !== undefined ? ` · retries ≤ ${test.maxRetries}` : ""}
      </small>
      {test.spec.fault !== "none" && (
        <small>
          {test.spec.fault.replaceAll("-", " ")} at {test.spec.faultAt}s
          {test.spec.fault !== "cache-flush"
            ? `, recovery at ${test.spec.recoverAt}s`
            : ""}
        </small>
      )}
    </div>
  ));
  return (
    <div className="challenge-play">
      <section className="challenge-mission">
        <div className="challenge-card-meta">
          <span>{active.difficulty} INCIDENT</span>
          <span>{active.author}</span>
        </div>
        <h3>{active.title}</h3>
        <p>{active.problem}</p>
        <ol className="challenge-process" aria-label="Interview exercise steps">
          <li>Inspect the baseline</li>
          <li>Repair the board</li>
          <li>Verify and submit</li>
        </ol>
        <div className="challenge-play-actions">
          <button
            className="save-button"
            disabled={status.running}
            onClick={() => props.onVerify(active, board)}
          >
            {status.running
              ? `${status.baseline ? "Diagnosing starter" : "Verifying fix"} · ${Math.round(status.progress)}%`
              : "Verify my fix"}
          </button>
          {status.running && (
            <button className="plain-button" onClick={props.onCancel}>
              Cancel verification
            </button>
          )}
          <button className="plain-button" onClick={() => props.onOpen(active)}>
            Restart incident
          </button>
        </div>
        {status.error && (
          <p role="alert" className="experiment-error">
            {status.error}
          </p>
        )}
        <div className="challenge-attempts">
          <span>{props.attempts} submissions this session</span>
          <span>{props.hints} hints revealed</span>
        </div>
        {goals}
        <div className="challenge-hints">
          <button
            disabled={props.hints >= active.hints.length}
            onClick={props.onHint}
          >
            Reveal next hint · {Math.min(props.hints, active.hints.length)} /{" "}
            {active.hints.length}
          </button>
          {active.hints.slice(0, props.hints).map((hint, index) => (
            <p key={index}>
              <b>Hint {index + 1}</b>
              {hint}
            </p>
          ))}
        </div>
        <p className="field-help">
          Earn one star for passing, one for using no hints, and one for a
          first-submission fix this session. Progress stays on this device.
        </p>
      </section>
      <section className="challenge-work">
        <div className="challenge-work-heading">
          <h3>Live resource budget</h3>
          <span>Change components or connection settings on the board.</span>
        </div>
        <CheckList checks={liveChecks} />
        {report && (
          <div
            className={`challenge-verdict ${report.passed && current ? "resolved" : "unresolved"}`}
          >
            <div>
              <strong>
                {current
                  ? report.passed
                    ? "Incident resolved"
                    : "The fix needs work"
                  : "Design changed since verification"}
              </strong>
              <span>
                {report.score}% of traffic tests passed
                {!current ? " · verify this revision" : ""}
              </span>
            </div>
            {report.passed && current && (
              <span
                className="challenge-award"
                title="Best stars earned on this device"
              >
                <small>Best </small>
                {"★".repeat(props.progress[active.id]?.stars ?? 1)}
              </span>
            )}
          </div>
        )}
        {report && <TestEvidence report={report} baseline={baseline} />}
        {!report && baseline && (
          <details className="starter-diagnosis" open>
            <summary>
              Starter diagnosis ·{" "}
              {baseline.tests.filter((t) => t.passed).length} /{" "}
              {active.tests.length} traffic tests passed
            </summary>
            <TestEvidence report={baseline} />
          </details>
        )}
        <div className="challenge-share">
          <button
            className="secondary-button"
            onClick={() => {
              try {
                const solution = parseBoard(serializeBoard(board));
                download(`${active.id}-submission.json`, {
                  format: "liveboard-submission-v1",
                  challenge: active,
                  solution,
                  assessment: current ? report : undefined,
                });
              } catch (error) {
                props.onToast(
                  error instanceof Error
                    ? error.message
                    : "Invalid solution board",
                );
              }
            }}
          >
            Download candidate submission
          </button>
          <button
            className="secondary-button challenge-report-download"
            disabled={!report || !current}
            onClick={() => {
              if (!report) return;
              try {
                const html = createChallengeReportHtml(active, board, report);
                const url = URL.createObjectURL(
                    new Blob([html], { type: "text/html" }),
                  ),
                  link = document.createElement("a");
                link.href = url;
                link.download = `${active.id}-assessment.html`;
                link.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
              } catch (error) {
                props.onToast(
                  error instanceof Error
                    ? error.message
                    : "Verify this design first.",
                );
              }
            }}
          >
            Download assessment
          </button>
          <button
            className="text-button"
            onClick={() => download(`${active.id}.json`, active)}
          >
            Exercise file
          </button>
        </div>
        <p className="field-help challenge-submission-status">
          {current
            ? "This revision has verified results. The submission includes the design, notes, and assessment."
            : "You can submit this design now. Verify this revision to attach current results."}
        </p>
        <p className="field-help">
          Reviewers import the original exercise before a submission, then run
          verification against the original definition.
        </p>
      </section>
    </div>
  );
}
function OptionalLimit({
  label,
  value,
  onChange,
}: {
  label: string;
  value?: number;
  onChange: (value: number | undefined) => void;
}) {
  return (
    <div className="optional-goal">
      <label className="lab-toggle">
        <input
          type="checkbox"
          checked={value !== undefined}
          onChange={(e) => onChange(e.target.checked ? 100 : undefined)}
        />
        {label}
      </label>
      {value !== undefined && (
        <Numeric
          label={label}
          value={value}
          min={0}
          max={100000}
          onChange={onChange}
        />
      )}
    </div>
  );
}
function TestEditor({
  test,
  index,
  onChange,
  onRemove,
}: {
  test: ChallengeTest;
  index: number;
  onChange: (test: ChallengeTest) => void;
  onRemove: () => void;
}) {
  const patch = (value: Partial<ChallengeTest>) =>
      onChange({ ...test, ...value }),
    spec = (value: Partial<ChallengeTest["spec"]>) =>
      patch({ spec: { ...test.spec, ...value } });
  return (
    <details className="author-test" open>
      <summary>
        Traffic test {index + 1} · {test.label}
      </summary>
      <label className="interview-field">
        Test label
        <input
          aria-label={`Test ${index + 1} label`}
          maxLength={120}
          value={test.label}
          onChange={(e) => patch({ label: e.target.value })}
        />
      </label>
      <div className="author-test-fields">
        <Numeric
          label={`Test ${index + 1} requests / second`}
          value={test.spec.rate}
          max={100}
          onChange={(rate) => spec({ rate })}
        />
        <Numeric
          label={`Test ${index + 1} duration · seconds`}
          value={test.spec.seconds}
          max={60}
          onChange={(seconds) => spec({ seconds })}
        />
        <label className="lab-field">
          <span>Success target · percent</span>
          <input
            className="field"
            aria-label={`Test ${index + 1} success target · percent`}
            type="number"
            min={0}
            max={100}
            step="0.01"
            value={test.spec.targetSuccess}
            onChange={(e) => {
              const value = e.currentTarget.valueAsNumber;
              if (Number.isFinite(value))
                spec({ targetSuccess: Math.max(0, Math.min(100, value)) });
            }}
          />
        </label>
        <Numeric
          label={`Test ${index + 1} P95 target · ms`}
          value={test.spec.targetP95}
          onChange={(targetP95) => spec({ targetP95 })}
        />
        <Option
          label={`Test ${index + 1} traffic pattern`}
          value={test.spec.pattern}
          choices={[
            ["hot-key", "One hot key"],
            ["round-robin", "Rotate seeded IDs"],
          ]}
          onChange={(pattern) =>
            spec({ pattern: pattern as ChallengeTest["spec"]["pattern"] })
          }
        />
        <Numeric
          label={`Test ${index + 1} record IDs`}
          value={test.spec.keys}
          max={100}
          onChange={(keys) => spec({ keys })}
        />
        <Option
          label={`Test ${index + 1} cache start`}
          value={test.spec.cacheStart}
          choices={[
            ["cold", "Cold"],
            ["warm", "Warm-up"],
          ]}
          onChange={(cacheStart) =>
            spec({ cacheStart: cacheStart as "cold" | "warm" })
          }
        />
        <Option
          label={`Test ${index + 1} failure`}
          value={test.spec.fault}
          choices={[
            ["none", "None"],
            ["database-outage", "Database outage"],
            ["cache-outage", "Cache outage"],
            ["backend-outage", "First backend outage"],
            ["cache-flush", "Cache flush"],
          ]}
          onChange={(fault) =>
            spec({ fault: fault as ChallengeTest["spec"]["fault"] })
          }
        />
        {test.spec.fault !== "none" && (
          <>
            <Numeric
              label={`Test ${index + 1} failure second`}
              value={test.spec.faultAt}
              min={0}
              max={60}
              onChange={(faultAt) => spec({ faultAt })}
            />
            {test.spec.fault !== "cache-flush" && (
              <Numeric
                label={`Test ${index + 1} recovery second`}
                value={test.spec.recoverAt}
                min={0}
                max={60}
                onChange={(recoverAt) => spec({ recoverAt })}
              />
            )}
          </>
        )}
      </div>
      <label className="interview-field">
        GET path
        <input
          aria-label={`Test ${index + 1} request path`}
          maxLength={200}
          value={test.spec.path}
          onChange={(e) => spec({ path: e.target.value })}
        />
      </label>
      <div className="author-extra-goals">
        {(["maxReads", "maxAttempts", "minBlocked", "maxRetries"] as const).map(
          (key, i) => (
            <OptionalLimit
              key={key}
              label={
                [
                  "Maximum DB reads",
                  "Maximum DB attempts",
                  "Minimum circuit rejections",
                  "Maximum retries",
                ][i]
              }
              value={test[key]}
              onChange={(value) => patch({ [key]: value })}
            />
          ),
        )}
      </div>
      <button className="text-button" onClick={onRemove}>
        Remove traffic test
      </button>
    </details>
  );
}
function Author(props: Props & { draft: ChallengeDefinition }) {
  const { draft, report, status } = props;
  const update = (patch: Partial<ChallengeDefinition>) =>
      props.onDraft((current) =>
        current ? { ...current, ...patch } : current,
      ),
    rules = (patch: Partial<ChallengeDefinition["rules"]>) =>
      update({ rules: { ...draft.rules, ...patch } });
  const verified =
    report?.definitionHash === definitionHash(draft) &&
    report.fingerprint === configFingerprint(executionConfig(props.board)) &&
    report.passed;
  const exportDraft = () => {
    try {
      download(`${draft.id}.json`, parseChallenge(draft));
    } catch (error) {
      props.onToast(
        error instanceof Error
          ? error.message
          : "Check the exercise definition",
      );
    }
  };
  return (
    <div className="challenge-author">
      <section>
        <h3>Build an employer exercise</h3>
        <p className="field-help">
          Capture the broken system first. Define the environment, resource
          budget, and HTTP traffic tests. Repair the board and verify a
          reference fix before sharing.
        </p>
        <label className="interview-field">
          Exercise title
          <input
            aria-label="Challenge title"
            maxLength={100}
            value={draft.title}
            onChange={(e) => update({ title: e.target.value })}
          />
        </label>
        <label className="interview-field">
          Author or team
          <input
            aria-label="Challenge author"
            maxLength={100}
            value={draft.author}
            onChange={(e) => update({ author: e.target.value })}
          />
        </label>
        <Option
          label="Challenge difficulty"
          value={draft.difficulty}
          choices={[
            ["Starter", "Starter"],
            ["Intermediate", "Intermediate"],
            ["Advanced", "Advanced"],
          ]}
          onChange={(difficulty) =>
            update({
              difficulty: difficulty as ChallengeDefinition["difficulty"],
            })
          }
        />
        <label className="interview-field">
          Incident brief
          <textarea
            aria-label="Challenge incident brief"
            maxLength={12000}
            value={draft.problem}
            onChange={(e) => update({ problem: e.target.value })}
          />
        </label>
        <div className="author-starter">
          <b>Captured starter: {draft.starter.title}</b>
          <span>
            {draft.starter.nodes.length} components ·{" "}
            {draft.starter.edges.length} connections
          </span>
          <button
            className="secondary-button"
            onClick={() => {
              try {
                update({ starter: parseBoard(serializeBoard(props.board)) });
                props.onToast("Starter board captured");
              } catch (error) {
                props.onToast(
                  error instanceof Error
                    ? error.message
                    : "Invalid starter board",
                );
              }
            }}
          >
            Capture current board as starter
          </button>
        </div>
        <h4>Resource budget</h4>
        <div className="author-test-fields">
          <Numeric
            label="Maximum backend instances"
            value={draft.rules.maxBackends}
            max={8}
            onChange={(maxBackends) => rules({ maxBackends })}
          />
          <Numeric
            label="Maximum total execution slots"
            value={draft.rules.maxSlots}
            max={128}
            onChange={(maxSlots) => rules({ maxSlots })}
          />
          <Numeric
            label="Maximum queue per backend"
            value={draft.rules.maxQueue}
            min={0}
            max={500}
            onChange={(maxQueue) => rules({ maxQueue })}
          />
          <Numeric
            label="Maximum backend timeout · ms"
            value={draft.rules.maxTimeout}
            onChange={(maxTimeout) => rules({ maxTimeout })}
          />
          <Numeric
            label="Maximum configured cache bytes"
            value={draft.rules.maxCacheBytes}
            min={64}
            max={1000000}
            onChange={(maxCacheBytes) => rules({ maxCacheBytes })}
          />
          <Numeric
            label="Minimum healthy routed backends"
            value={draft.rules.minHealthy}
            max={8}
            onChange={(minHealthy) => rules({ minHealthy })}
          />
        </div>
        <label className="lab-toggle">
          <input
            type="checkbox"
            checked={draft.rules.preserveComponents}
            onChange={(e) => rules({ preserveComponents: e.target.checked })}
          />
          Preserve starter components and roles
        </label>
        <h4>Protected environment</h4>
        {protectedFields.map((field) => (
          <label className="lab-toggle" key={field}>
            <input
              type="checkbox"
              checked={draft.rules.locked.includes(field)}
              onChange={(e) =>
                rules({
                  locked: e.target.checked
                    ? [...draft.rules.locked, field]
                    : draft.rules.locked.filter((v) => v !== field),
                })
              }
            />
            {protectionLabels[field]}
          </label>
        ))}
        <h4>Progressive hints</h4>
        {draft.hints.map((hint, index) => (
          <label className="interview-field" key={index}>
            Hint {index + 1}
            <textarea
              aria-label={`Challenge hint ${index + 1}`}
              maxLength={2000}
              value={hint}
              onChange={(e) =>
                update({
                  hints: draft.hints.map((old, i) =>
                    i === index ? e.target.value : old,
                  ),
                })
              }
            />
          </label>
        ))}
        <button
          className="text-button"
          disabled={draft.hints.length >= 5}
          onClick={() =>
            update({ hints: [...draft.hints, "Inspect the request evidence."] })
          }
        >
          Add hint
        </button>
      </section>
      <section>
        <div className="challenge-work-heading">
          <h3>HTTP traffic tests</h3>
          <span>{draft.tests.length} / 5 tests</span>
        </div>
        {draft.tests.map((test, index) => (
          <TestEditor
            key={test.id}
            test={test}
            index={index}
            onChange={(changed) =>
              update({
                tests: draft.tests.map((old) =>
                  old.id === test.id ? changed : old,
                ),
              })
            }
            onRemove={() =>
              update({ tests: draft.tests.filter((old) => old.id !== test.id) })
            }
          />
        ))}
        <button
          className="secondary-button"
          disabled={draft.tests.length >= 5}
          onClick={() =>
            update({
              tests: [
                ...draft.tests,
                {
                  id: `test-${crypto.randomUUID()}`,
                  label: `Traffic test ${draft.tests.length + 1}`,
                  spec: { ...experimentDefaults, targetP95: 2000 },
                },
              ],
            })
          }
        >
          Add traffic test
        </button>
        <div
          className={`challenge-verdict ${verified ? "resolved" : "unresolved"}`}
        >
          <strong>
            {verified
              ? "Reference design passes"
              : "Reference fix not verified for this draft"}
          </strong>
        </div>
        <div className="challenge-play-actions">
          <button
            className="save-button"
            disabled={status.running}
            onClick={() => props.onVerify(draft, props.board, { author: true })}
          >
            {status.running
              ? `Verifying · ${Math.round(status.progress)}%`
              : "Verify current board as reference"}
          </button>
          {status.running && (
            <button className="plain-button" onClick={props.onCancel}>
              Cancel verification
            </button>
          )}
          <button className="secondary-button" onClick={exportDraft}>
            Download exercise
          </button>
          <button
            className="plain-button"
            onClick={() => {
              try {
                props.onOpen(parseChallenge(draft));
              } catch (error) {
                props.onToast(
                  error instanceof Error ? error.message : "Invalid exercise",
                );
              }
            }}
          >
            Play captured starter
          </button>
        </div>
        {status.error && (
          <p role="alert" className="experiment-error">
            {status.error}
          </p>
        )}
        {report?.definitionHash === definitionHash(draft) && (
          <>
            <CheckList checks={report.constraints} />
            <TestEvidence report={report} />
          </>
        )}
        <p className="field-help">
          Candidates import the exercise file, change the board, and download a
          submission. To review a submission, import the original exercise
          first. Verification reruns the original tests.
        </p>
      </section>
    </div>
  );
}
export default function ChallengePanel(props: Props) {
  const create = () => {
    try {
      props.onDraft(createChallenge(props.board));
      props.onView("author");
    } catch (error) {
      props.onToast(
        error instanceof Error
          ? error.message
          : "A challenge needs an HTTP board",
      );
    }
  };
  return (
    <div className="challenge-panel">
      <header className="challenge-heading">
        <div>
          <b>Incident challenges</b>
          <span>Diagnose. Repair. Verify.</span>
        </div>
        <nav aria-label="Challenge views">
          <button
            className={props.view === "gallery" ? "active" : ""}
            onClick={() => props.onView("gallery")}
          >
            Challenge library
          </button>
          {props.active && (
            <button
              className={props.view === "play" ? "active" : ""}
              onClick={() => props.onView("play")}
            >
              Current incident
            </button>
          )}
          <button
            className={props.view === "author" ? "active" : ""}
            onClick={() => {
              if (!props.draft) create();
              else props.onView("author");
            }}
          >
            Create exercise
          </button>
        </nav>
      </header>
      {props.view === "gallery" && (
        <Gallery
          progress={props.progress}
          onOpen={props.onOpen}
          onCreate={create}
        />
      )}{" "}
      {props.view === "play" && props.active && (
        <Play {...props} active={props.active} />
      )}{" "}
      {props.view === "author" && props.draft && (
        <Author {...props} draft={props.draft} />
      )}
    </div>
  );
}
