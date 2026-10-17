import { parseBoard, serializeBoard, type Board } from "../board/board";
import {
  parseChallenge,
  type ChallengeDefinition,
} from "../challenges/challenges";

export type LocalWorkspace = {
  board: Board;
  active?: ChallengeDefinition;
  draft?: ChallengeDefinition;
  view: "gallery" | "play" | "author";
};

export function parseWorkspace(text: string): LocalWorkspace {
  if (text.length > 6_000_000)
    throw new Error("The saved workspace is too large.");
  const raw = JSON.parse(text);
  if (raw?.format !== "liveboard-workspace-v1")
    return { board: parseBoard(text), view: "gallery" };
  if (!["gallery", "play", "author"].includes(raw.view))
    throw new Error("Invalid saved assessment view.");
  return {
    board: parseBoard(JSON.stringify(raw.board)),
    active: raw.active ? parseChallenge(raw.active) : undefined,
    draft: raw.draft ? parseChallenge(raw.draft) : undefined,
    view: raw.view,
  };
}

export function serializeWorkspace(workspace: LocalWorkspace): string {
  return JSON.stringify({
    format: "liveboard-workspace-v1",
    board: parseBoard(serializeBoard(workspace.board)),
    active: workspace.active ? parseChallenge(workspace.active) : undefined,
    draft: workspace.draft ? parseChallenge(workspace.draft) : undefined,
    view: workspace.view,
  });
}

export function boardFilename(title: string): string {
  const name = title
    .trim()
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${name || "liveboard"}.json`;
}
