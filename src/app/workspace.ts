import {
  catalog,
  parseBoard,
  serializeBoard,
  type Board,
} from "../board/board";
import {
  parseChallenge,
  type ChallengeDefinition,
} from "../challenges/challenges";
import { defaults } from "../simulation/engine";
import { consumerDefaults, kafkaDefaults } from "../simulation/kafka";

export type WorkspaceView = "gallery" | "play" | "author";
export type LocalWorkspace = {
  board: Board;
  active?: ChallengeDefinition;
  draft?: ChallengeDefinition;
  view: WorkspaceView;
  /** Missing on workspaces saved before multi-tab revisions. */
  revision?: number;
};

const routePattern = /^\/[\w/-]*:id$/;

function validName(name: unknown): name is string {
  return typeof name === "string" && !!name.trim() && name.length <= 80;
}
function validRoute(route: unknown): route is string {
  return typeof route === "string" && routePattern.test(route);
}
function validLabel(value: unknown): value is string {
  return (
    typeof value === "string" &&
    !!value.trim() &&
    value.length <= 4096 &&
    !/[\u0000-\u001f]/.test(value)
  );
}
function repairBoard(board: Board, previous?: Board): Board {
  const previousNames = new Map(
    previous?.nodes.map((node) => [node.id, String(node.data.name ?? "")]) ??
      [],
  );
  const nodes = board.nodes.map((node) => {
    const current = String(node.data.name ?? "");
    const fallback = previousNames.get(node.id);
    const name = validName(current)
      ? current
      : validName(fallback)
        ? fallback
        : (catalog.find((item) => item.role === node.data.role)?.name ??
          "Component");
    return { ...node, data: { ...node.data, name } };
  });
  const config = {
    ...board.config,
    kafka: { ...board.config.kafka },
    consumerOverrides: Object.fromEntries(
      Object.entries(board.config.consumerOverrides ?? {}).map(
        ([id, settings]) => [id, { ...settings }],
      ),
    ),
    backendOverrides: board.config.backendOverrides
      ? Object.fromEntries(
          Object.entries(board.config.backendOverrides).map(([id, settings]) => [
            id,
            { ...settings },
          ]),
        )
      : undefined,
  };
  const priorRoute = previous?.config.route;
  config.route = validRoute(config.route)
    ? config.route
    : validRoute(priorRoute)
      ? priorRoute
      : defaults.route;
  for (const [id, settings] of Object.entries(config.backendOverrides ?? {})) {
    if (settings.route !== undefined && !validRoute(settings.route)) {
      const prior = previous?.config.backendOverrides?.[id]?.route;
      if (validRoute(prior)) settings.route = prior;
      else delete settings.route;
    }
  }
  if (!validLabel(config.kafka.topic)) {
    const prior = previous?.config.kafka.topic;
    config.kafka.topic = validLabel(prior) ? prior : kafkaDefaults.topic;
  }
  for (const [id, settings] of Object.entries(config.consumerOverrides)) {
    if (settings.groupId !== undefined && !validLabel(settings.groupId)) {
      const prior = previous?.config.consumerOverrides?.[id]?.groupId;
      if (validLabel(prior)) settings.groupId = prior;
      else settings.groupId = consumerDefaults.groupId;
    }
  }
  return { ...board, nodes, config };
}
function repairChallenge(
  value: ChallengeDefinition | undefined,
  previous?: ChallengeDefinition,
): ChallengeDefinition | undefined {
  if (!value) return undefined;
  const next = {
    ...value,
    title: value.title.trim()
      ? value.title
      : previous?.title.trim() || "Untitled exercise",
    problem: value.problem.trim()
      ? value.problem
      : previous?.problem.trim() || "Describe the incident.",
  };
  try {
    return parseChallenge(next);
  } catch {
    if (!previous) return undefined;
    try {
      return parseChallenge(previous);
    } catch {
      return undefined;
    }
  }
}
function revisionOf(raw: Record<string, unknown>): number {
  if (raw.revision === undefined) return 0;
  if (
    typeof raw.revision === "number" &&
    Number.isInteger(raw.revision) &&
    raw.revision >= 0 &&
    raw.revision <= Number.MAX_SAFE_INTEGER
  )
    return raw.revision;
  throw new Error("Invalid workspace revision.");
}
export function parseWorkspace(text: string): LocalWorkspace {
  if (text.length > 6_000_000)
    throw new Error("The saved workspace is too large.");
  const raw = JSON.parse(text);
  if (raw?.format !== "liveboard-workspace-v1")
    return { board: parseBoard(text), view: "gallery", revision: 0 };
  if (!["gallery", "play", "author"].includes(raw.view))
    throw new Error("Invalid saved assessment view.");
  return {
    board: parseBoard(JSON.stringify(raw.board)),
    active: raw.active ? parseChallenge(raw.active) : undefined,
    draft: raw.draft ? parseChallenge(raw.draft) : undefined,
    view: raw.view,
    revision: revisionOf(raw),
  };
}
export function serializeWorkspace(
  workspace: LocalWorkspace,
  previous?: LocalWorkspace,
): string {
  const view: WorkspaceView =
    workspace.view === "play" || workspace.view === "author"
      ? workspace.view
      : "gallery";
  return JSON.stringify({
    format: "liveboard-workspace-v1",
    revision: workspace.revision ?? 0,
    board: parseBoard(
      serializeBoard(repairBoard(workspace.board, previous?.board)),
    ),
    active: repairChallenge(workspace.active, previous?.active),
    draft: repairChallenge(workspace.draft, previous?.draft),
    view,
  });
}
export function boardWasRepaired(
  workspace: LocalWorkspace,
  previous?: LocalWorkspace,
): boolean {
  const saved = parseWorkspace(serializeWorkspace(workspace, previous));
  const names = new Map(
    saved.board.nodes.map((node) => [node.id, String(node.data.name)]),
  );
  return (
    workspace.board.nodes.some(
      (node) => names.get(node.id) !== String(node.data.name ?? ""),
    ) ||
    saved.board.config.route !== workspace.board.config.route ||
    saved.draft?.title !== workspace.draft?.title ||
    saved.draft?.problem !== workspace.draft?.problem
  );
}
export function boardFilename(title: string): string {
  const name = title
    .trim()
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${name || "liveboard"}.json`;
}
