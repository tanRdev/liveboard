import type { Board } from "../board/board";
import type { ExperimentReport } from "../simulation/experiments";
import type { InterviewBrief } from "./interview";
export function escapeHtml(value: unknown) {
  return String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
}
export function boardDiagram(board: Board) {
  if (!board.nodes.length) return "";
  const xs = board.nodes.map((n) => n.position.x),
    ys = board.nodes.map((n) => n.position.y);
  const left = Math.min(...xs) - 20,
    top = Math.min(...ys) - 20,
    width = Math.max(...xs) - left + 220,
    height = Math.max(...ys) - top + 110;
  const edges = board.edges
    .map((edge) => {
      const a = board.nodes.find((n) => n.id === edge.source),
        b = board.nodes.find((n) => n.id === edge.target);
      return a && b
        ? `<line x1="${a.position.x + 180}" y1="${a.position.y + 35}" x2="${b.position.x}" y2="${b.position.y + 35}" stroke="#9aaa99" stroke-width="2" marker-end="url(#arrow)"/>`
        : "";
    })
    .join("");
  const nodes = board.nodes
    .map(
      (node) =>
        `<g transform="translate(${node.position.x},${node.position.y})"><rect width="180" height="70" rx="7" fill="#f7faf3" stroke="#b9ccb0"/><text x="12" y="27" font-size="12" font-weight="600">${escapeHtml(String(node.data.name).slice(0, 25))}</text><text x="12" y="48" font-size="10" fill="#73816a">${escapeHtml(node.data.role)}</text></g>`,
    )
    .join("");
  return `<svg role="img" aria-label="Measured system diagram" viewBox="${left} ${top} ${width} ${height}" xmlns="http://www.w3.org/2000/svg"><defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L7,3 z" fill="#9aaa99"/></marker></defs>${edges}${nodes}</svg>`;
}
export function createReportHtml(
  board: Board,
  report: ExperimentReport,
  brief: InterviewBrief,
) {
  const e = escapeHtml;
  const metrics = [
    ["Offered requests", report.offered],
    ["Successful responses", report.success],
    ["Failed responses", report.failed],
    ["Pending after drain", report.pending],
    ["Success of offered load", `${report.successPercent.toFixed(2)}%`],
    [
      "Successful response P95",
      report.success ? `${report.p95} ms` : "No successful responses",
    ],
    [
      "Successful response P99",
      report.success ? `${report.p99} ms` : "No successful responses",
    ],
    ["Average queue wait", `${Math.round(report.averageWait)} ms`],
    ["Database reads", report.reads],
    ["Database attempts", report.attempts],
    ["Retries", report.retries],
    ["Circuit rejections", report.blocked],
  ];
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(report.spec.name)} · Liveboard interview evidence</title><style>body{font:15px/1.65 system-ui;color:#2f3f32;background:#f5f7f1;margin:0}main{max-width:960px;margin:40px auto;padding:40px;background:white;border:1px solid #e0e7d9;border-radius:10px}h1{font-size:28px;line-height:1.2}h2{font-size:18px;margin-top:32px}h3{font-size:15px}p,pre{white-space:pre-wrap;overflow-wrap:anywhere}.eyebrow{font-size:11px;color:#708662;letter-spacing:1px}.metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.metric{background:#f4f7ef;padding:12px;border-radius:6px}.metric span{display:block;font-size:11px;color:#748368}.metric b{font-size:20px}table{width:100%;border-collapse:collapse;font-size:12px}td,th{padding:8px;text-align:left;border-bottom:1px solid #e1e8db}svg{width:100%;max-height:450px}.pass{color:#4b7d45}.fail{color:#b06f51}pre{font-size:11px;background:#f6f8f2;padding:12px;border-radius:5px}details{margin:12px 0}footer{margin-top:32px;color:#8a957e;font-size:11px}@media print{body{background:white}main{margin:0;padding:0;border:0}details{break-inside:avoid}}</style><main><div class="eyebrow">LIVEBOARD · INTERVIEW EVIDENCE</div><h1>${e(board.title)}</h1><p>${e(brief.prompt)}</p><h2>Measured design</h2>${boardDiagram(board)}<h2>${e(report.spec.name)}</h2><p>${e(report.spec.rate)} requests/s for ${e(report.spec.seconds)} simulated seconds. ${e(report.spec.pattern)} workload. ${e(report.spec.cacheStart)} cache start. Configuration ${e(report.fingerprint)}.</p><p class="${report.passed ? "pass" : "fail"}">${report.passed ? "Targets met" : "Targets not met"} · target success ${e(report.spec.targetSuccess)}% · target P95 ${e(report.spec.targetP95)} ms</p><div class="metrics">${metrics.map(([label, value]) => `<div class="metric"><span>${e(label)}</span><b>${e(value)}</b></div>`).join("")}</div><p>Percentiles include every successful response for this offered workload, including responses completed during the drain. Unfinished requests count against success. Drain: ${e(report.drainMs)} ms.</p><h2>Requirements</h2><p>${e(brief.requirements)}</p><h2>Assumptions</h2><p>${e(brief.assumptions || "No assumptions recorded.")}</p><h2>Design decisions</h2><p>${e(brief.decisions || "No decisions recorded.")}</p><h2>Failure timeline</h2><ul>${report.timeline.length ? report.timeline.map((event) => `<li>${e(event.second)}s · ${e(event.text)}</li>`).join("") : "<li>No scheduled failure.</li>"}</ul><h2>Response codes</h2><p>${Object.entries(
    report.statuses,
  )
    .map(([status, count]) => `${e(status)}: ${e(count)}`)
    .join(
      " · ",
    )}</p><h2>Evidence traces</h2>${report.examples.map((example) => `<details><summary>Request ${e(example.id)} · HTTP ${e(example.status)} · ${e(example.duration)} ms</summary><table><thead><tr><th>Simulation time</th><th>Component</th><th>Decision</th></tr></thead><tbody>${example.trace.map((event) => `<tr><td>${e((event.time / 1000).toFixed(3))}s</td><td>${e(event.component)}</td><td>${e(event.text)}</td></tr>`).join("")}</tbody></table></details>`).join("")}<h2>Measured configuration</h2><pre>${e(JSON.stringify(board.config, null, 2))}</pre><footer>Generated by Liveboard. Results use the app's deterministic simulation and modeled component delays.</footer></main></html>`;
}
