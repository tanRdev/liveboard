import { describe, expect, it } from "vitest";
import { scenario, serializeBoard } from "../board/board";
import { createChallenge } from "../challenges/challenges";
import { briefForLoad, defaultBrief } from "../interview/interview";
import { checkoutScenario } from "../scenarios/checkout";
import {
  boardFilename,
  boardWasRepaired,
  parseWorkspace,
  serializeWorkspace,
} from "./workspace";

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
  it("saves the board when a draft title or component field is unfinished", () => {
    const board = scenario("cache");
    const previous = parseWorkspace(
      serializeWorkspace({ board, view: "author", revision: 2 }),
    );
    board.nodes[0].data.name = "   ";
    board.config.route = "/users";
    board.config.ttl = 12;
    board.config.kafka.topic = "   ";
    const draft = createChallenge(scenario("cache"));
    draft.title = "";
    draft.problem = "The cache expires before the next read.";
    const text = serializeWorkspace(
      { board, draft, view: "author", revision: 2 },
      previous,
    );
    const restored = parseWorkspace(text);
    expect(restored.revision).toBe(2);
    expect(restored.board.config.ttl).toBe(12);
    expect(restored.board.config.route).toBe("/users/:id");
    expect(restored.board.config.kafka.topic).toBe("orders");
    expect(restored.board.nodes[0].data.name).toBe("Client");
    expect(restored.draft?.title).toBe("Untitled exercise");
    expect(restored.draft?.problem).toBe(
      "The cache expires before the next read.",
    );
    expect(
      boardWasRepaired({ board, draft, view: "author" }, previous),
    ).toBe(true);
  });
  it("restores the last valid route and draft title while keeping newer edits", () => {
    const board = scenario("cache");
    board.config.route = "/profiles/:id";
    const draft = createChallenge(board);
    draft.title = "Cache incident";
    const previous = parseWorkspace(
      serializeWorkspace({ board, draft, view: "author" }),
    );
    board.config.route = "/profiles/";
    board.config.concurrency = 6;
    draft.title = "";
    draft.problem = "Updated incident.";
    const restored = parseWorkspace(
      serializeWorkspace({ board, draft, view: "author" }, previous),
    );
    expect(restored.board.config.route).toBe("/profiles/:id");
    expect(restored.board.config.concurrency).toBe(6);
    expect(restored.draft?.title).toBe("Cache incident");
    expect(restored.draft?.problem).toBe("Updated incident.");
  });
  it("reads workspaces saved before revisions", () => {
    const board = scenario("cache");
    const raw = JSON.parse(serializeWorkspace({ board, view: "gallery" }));
    delete raw.revision;
    expect(parseWorkspace(JSON.stringify(raw)).revision).toBe(0);
  });
  it("uses the board brief when a template has one and the default otherwise", () => {
    expect(briefForLoad(scenario("cache")).prompt).toBe(defaultBrief.prompt);
    expect(briefForLoad(checkoutScenario()).prompt).toContain("checkout");
    expect(
      briefForLoad(scenario("cache"), {
        ...defaultBrief,
        prompt: "Preset prompt",
      }).prompt,
    ).toBe("Preset prompt");
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
