import { parseWorkspace, type LocalWorkspace } from "./workspace";

export const WORKSPACE_KEY = "liveboard-v1";
export const RECOVERY_KEY = "liveboard-v1-recovery";
export const RECOVERY_PREVIOUS_KEY = "liveboard-v1-recovery-previous";

export type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export type LoadResult =
  | { status: "empty" }
  | { status: "ok"; workspace: LocalWorkspace; text: string }
  | { status: "unreadable"; text: string; preserved: boolean };

export type WritePlan =
  | { action: "write"; text: string; revision: number }
  | { action: "adopt"; revision: number }
  | { action: "conflict"; storedText: string; storedRevision: number }
  | { action: "refuse"; reason: "unreadable" | "quarantine" };

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}
export function workspaceBody(text: string): string {
  try {
    const raw = JSON.parse(text) as Record<string, unknown> | null;
    if (raw && typeof raw === "object" && !Array.isArray(raw))
      delete raw.revision;
    return JSON.stringify(canonical(raw));
  } catch {
    return text;
  }
}
export function workspaceContent(text: string): string {
  try {
    const raw = JSON.parse(text) as {
      revision?: number;
      board?: { nodes?: { position?: unknown }[] };
    };
    delete raw.revision;
    for (const node of raw.board?.nodes ?? []) delete node.position;
    return JSON.stringify(canonical(raw));
  } catch {
    return text;
  }
}

export function storedRevision(text: string | null): number | "unreadable" {
  if (!text) return 0;
  try {
    const raw = JSON.parse(text) as Record<string, unknown> | null;
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
      return "unreadable";
    if (raw.format !== "liveboard-workspace-v1") return 0;
    if (raw.revision === undefined) return 0;
    if (
      typeof raw.revision === "number" &&
      Number.isInteger(raw.revision) &&
      raw.revision >= 0 &&
      raw.revision <= Number.MAX_SAFE_INTEGER
    )
      return raw.revision;
    return "unreadable";
  } catch {
    return "unreadable";
  }
}

export function planWorkspaceWrite(input: {
  baseRevision: number;
  storedText: string | null;
  nextText: string;
  blockWrites?: boolean;
}): WritePlan {
  if (input.blockWrites) return { action: "refuse", reason: "quarantine" };
  const revision = storedRevision(input.storedText);
  if (revision === "unreadable") {
    const raw = JSON.parse(input.nextText) as Record<string, unknown>;
    raw.revision = 1;
    return { action: "write", text: JSON.stringify(raw), revision: 1 };
  }
  const nextBody = workspaceBody(input.nextText);
  const storedBody = input.storedText ? workspaceBody(input.storedText) : "";
  if (input.storedText && revision > input.baseRevision) {
    if (storedBody === nextBody) return { action: "adopt", revision };
    return {
      action: "conflict",
      storedText: input.storedText,
      storedRevision: revision,
    };
  }
  if (input.storedText && storedBody === nextBody)
    return { action: "adopt", revision };
  const nextRevision = revision + 1;
  const raw = JSON.parse(input.nextText) as Record<string, unknown>;
  raw.revision = nextRevision;
  return {
    action: "write",
    text: JSON.stringify(raw),
    revision: nextRevision,
  };
}

export function recoveryText(record: string | null): string | undefined {
  if (!record) return undefined;
  try {
    const raw = JSON.parse(record) as Record<string, unknown> | null;
    if (
      raw?.format === "liveboard-recovery-v1" &&
      typeof raw.text === "string" &&
      raw.text.length > 0
    )
      return raw.text;
  } catch {
    return undefined;
  }
  return undefined;
}

function preserveUnreadable(
  storage: StorageLike,
  text: string,
  now: number,
): boolean {
  const record = JSON.stringify({
    format: "liveboard-recovery-v1",
    savedAt: now,
    text,
  });
  try {
    const existing = storage.getItem(RECOVERY_KEY);
    if (existing && recoveryText(existing) !== text) {
      if (!storage.getItem(RECOVERY_PREVIOUS_KEY))
        storage.setItem(RECOVERY_PREVIOUS_KEY, existing);
    }
    storage.setItem(RECOVERY_KEY, record);
    return recoveryText(storage.getItem(RECOVERY_KEY)) === text;
  } catch {
    return false;
  }
}

export function loadStoredWorkspace(
  storage: StorageLike,
  now = Date.now(),
): LoadResult {
  let text: string | null;
  try {
    text = storage.getItem(WORKSPACE_KEY);
  } catch {
    return { status: "empty" };
  }
  if (!text) return { status: "empty" };
  try {
    return { status: "ok", workspace: parseWorkspace(text), text };
  } catch {
    return {
      status: "unreadable",
      text,
      preserved: preserveUnreadable(storage, text, now),
    };
  }
}

export function discardRecovery(storage: StorageLike) {
  try {
    storage.removeItem(RECOVERY_KEY);
    storage.removeItem(RECOVERY_PREVIOUS_KEY);
  } catch {
    /* The banner can close even when storage is blocked. */
  }
}
