import { executionConfig, type Board } from "./board";
import { configFingerprint } from "./experiments";
import {
  definitionHash,
  type ChallengeDefinition,
  type ChallengeReport,
  type Check,
} from "./challenges";
import { boardDiagram, escapeHtml as e } from "./report";
function checksTable(checks: Check[]): string {
  return `<table><thead><tr><th>Check</th><th>Observed</th><th>Required</th><th>Result</th></tr></thead><tbody>${checks.map((check) => `<tr><td>${e(check.label)}</td><td>${e(check.actual)}</td><td>${e(check.expected)}</td><td class="${check.passed ? "pass" : "fail"}">${check.passed ? "Pass" : "Fail"}</td></tr>`).join("")}</tbody></table>`;
}
export function createChallengeReportHtml(
  definition: ChallengeDefinition,
  board: Board,
  report: ChallengeReport,
): string {
  if (
    report.fingerprint !== configFingerprint(executionConfig(board)) ||
    report.definitionHash !== definitionHash(definition)
  )
    throw new Error(
      "Verify the current design before downloading its assessment.",
    );
  const brief = board.interview;
  const results = report.tests
    .map((test) => {
      const measured = test.report;
      const evidence = measured.examples
        .map(
          (example) =>
            `<details open><summary>Request ${example.id} · HTTP ${example.status} · ${Math.round(example.duration)} ms</summary><table><thead><tr><th>Time</th><th>Component</th><th>Decision</th></tr></thead><tbody>${example.trace.map((event) => `<tr><td>${e((event.time / 1000).toFixed(3))}s</td><td>${e(event.component)}</td><td>${e(event.text)}</td></tr>`).join("")}</tbody></table></details>`,
        )
        .join("");
      return `<section><h2>${e(test.label)} <small class="${test.passed ? "pass" : "fail"}">${test.passed ? "Passed" : "Needs work"}</small></h2><p>${measured.spec.rate} requests/s for ${measured.spec.seconds} simulated seconds. ${e(measured.spec.pattern)} traffic, ${e(measured.spec.cacheStart)} cache start.</p>${checksTable(test.checks)}<p>${measured.offered} offered · ${measured.success} successful · ${measured.failed} failed · ${measured.pending} pending · ${measured.reads} database reads · ${measured.attempts} database attempts.</p><h3>Failure timeline</h3><ul>${measured.timeline.length ? measured.timeline.map((item) => `<li>${item.second}s · ${e(item.text)}</li>`).join("") : "<li>No scheduled failure.</li>"}</ul><h3>Request evidence</h3>${evidence}</section>`;
    })
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(definition.title)} · Liveboard assessment</title><style>body{font:14px/1.6 system-ui;margin:0;background:#f3f6f4;color:#263d31}main{max-width:1000px;margin:32px auto;padding:36px;background:white;border:1px solid #dce5de;border-radius:12px}h1{font-size:28px;line-height:1.3}h2{font-size:19px;margin:30px 0 12px}h3{font-size:14px}small,.meta{font-size:11px;color:#738578}.verdict{padding:18px;background:#f0f5f1;border-radius:8px;font-size:20px;font-weight:650}.pass{color:#23794b}.fail{color:#ae493d}table{width:100%;border-collapse:collapse;font-size:12px}th,td{text-align:left;padding:8px;border-bottom:1px solid #e4eae5;vertical-align:top}p,pre{white-space:pre-wrap;overflow-wrap:anywhere}svg{width:100%;max-height:500px}details{margin:12px 0}summary{font-weight:600}pre{font-size:10px;background:#f6f8f6;padding:16px}section{margin-top:28px}@media print{body{background:white}main{margin:0;padding:0;border:0}tr{break-inside:avoid}}</style></head><body><main><p class="meta">LIVEBOARD · INTERVIEW ASSESSMENT</p><h1>${e(definition.title)}</h1><p>${e(definition.problem)}</p><p class="meta">${e(definition.author)} · ${e(definition.difficulty)} · Design ${e(report.fingerprint)}</p><div class="verdict ${report.passed ? "pass" : "fail"}">${report.passed ? "Incident resolved" : "The fix needs work"} · ${report.score}% of traffic tests passed</div><h2>Submitted design</h2>${boardDiagram(board)}<h2>Resource and environment checks</h2>${checksTable(report.constraints)}${!report.tests.length ? "<p>Resource or environment checks failed. Traffic tests did not run.</p>" : ""}${results}<h2>Design assumptions</h2><p>${e(brief?.assumptions || "No assumptions recorded.")}</p><h2>Decisions and trade-offs</h2><p>${e(brief?.decisions || "No decisions recorded.")}</p><h2>Measured configuration</h2><pre>${e(JSON.stringify(executionConfig(board), null, 2))}</pre></main></body></html>`;
}
