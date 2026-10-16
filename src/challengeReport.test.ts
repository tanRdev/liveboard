import { describe, expect, it } from "vitest";
import { challengeCatalog } from "./challengeCatalog";
import { ChallengeRunner } from "./challenges";
import { createChallengeReportHtml } from "./challengeReport";
function captured() {
  const definition = structuredClone(challengeCatalog[0]),
    board = structuredClone(definition.starter);
  const runner = new ChallengeRunner(definition, board);
  for (let i = 0; !runner.finished && i < 20000; i++) runner.tick();
  if (!runner.report) throw Error("Assessment did not finish");
  return { definition, board, report: runner.report };
}
describe("Printable interview assessment", () => {
  it("includes every traffic test, constraints, design, decisions, and evidence", () => {
    const { definition, board, report } = captured();
    board.interview!.decisions = "Scale within the eight-slot budget.";
    const html = createChallengeReportHtml(definition, board, report);
    expect(html).toContain("Normal traffic");
    expect(html).toContain("Launch traffic");
    expect(html).toContain("Resource and environment checks");
    expect(html).toContain("Measured system diagram");
    expect(html).toContain("Scale within the eight-slot budget.");
    expect(html).toContain("Request evidence");
    expect(html).toContain("The fix needs work");
  });
  it("rejects results from a previous design or definition", () => {
    const { definition, board, report } = captured();
    board.config.concurrency++;
    expect(() => createChallengeReportHtml(definition, board, report)).toThrow(
      "Verify the current design",
    );
    board.config.concurrency--;
    definition.tests[0].spec.targetP95++;
    expect(() => createChallengeReportHtml(definition, board, report)).toThrow(
      "Verify the current design",
    );
  });
  it("escapes candidate notes and trace text", () => {
    const { definition, board, report } = captured();
    board.interview!.assumptions = "<script>alert(1)</script>";
    report.tests[0].report.examples[0].trace[0].text =
      "<script>alert(3)</script>";
    const html = createChallengeReportHtml(definition, board, report);
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("&lt;script&gt;alert(3)&lt;/script&gt;");
  });
});
