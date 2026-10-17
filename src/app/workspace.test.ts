import { describe, expect, it } from "vitest";
import { scenario, serializeBoard } from "../board/board";
import { createChallenge } from "../challenges/challenges";
import { boardFilename, parseWorkspace, serializeWorkspace } from "./workspace";

describe("local workspace documents", () => {
  it("restores boards saved before assessment autosave", () => {
    const board = scenario("cache");
    expect(parseWorkspace(serializeBoard(board)).board.title).toBe(board.title);
  });
  it("keeps the original exercise separate from the candidate's changes", () => {
    const board = scenario("cache");
    const active = createChallenge(board);
    board.nodes[1].data.name = "Candidate's service";
    board.config.concurrency = 4;
    board.nodes[0].data.state = { transient: true };
    const text = serializeWorkspace({
      board,
      active,
      draft: active,
      view: "play",
    });
    expect(text).not.toContain('"transient"');
    const restored = parseWorkspace(text);
    expect(restored.board.config.concurrency).toBe(4);
    expect(restored.active?.starter.config.concurrency).toBe(1);
    expect(restored.draft?.problem).toBe(active.problem);
    expect(restored.view).toBe("play");
  });
  it("does not persist an invalid exercise draft", () => {
    const board = scenario("cache");
    const draft = createChallenge(board);
    draft.title = "";
    expect(() =>
      serializeWorkspace({ board, draft, view: "author" }),
    ).toThrow();
  });
  it("rejects malformed or oversized stored documents", () => {
    expect(() => parseWorkspace("{")).toThrow();
    expect(() => parseWorkspace("x".repeat(6_000_001))).toThrow();
    expect(() =>
      parseWorkspace(
        JSON.stringify({ format: "liveboard-workspace-v1", view: "other" }),
      ),
    ).toThrow();
  });
  it("gives downloaded boards recognizable, safe filenames", () => {
    expect(boardFilename("Company / Checkout Incident")).toBe(
      "Company-Checkout-Incident.json",
    );
    expect(boardFilename("...")).toBe("liveboard.json");
  });
});
