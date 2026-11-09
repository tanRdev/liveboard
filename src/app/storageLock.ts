import {
  planWorkspaceWrite,
  WORKSPACE_KEY,
  type StorageLike,
  type WritePlan,
} from "./persistence";

export const STORAGE_LOCK = "liveboard-storage";
export const PROGRESS_KEY = "liveboard-progress-v1";

export type StorageLock = <T>(run: () => T | Promise<T>) => Promise<T>;

export type ChallengeProgress = {
  submissions: number;
  stars: number;
  bestScore: number;
};

export function browserStorageLock<T>(run: () => T | Promise<T>): Promise<T> {
  const locks = globalThis.navigator?.locks;
  if (!locks?.request) return Promise.resolve(run());
  return locks.request(STORAGE_LOCK, () => run());
}

export function createMutex(): StorageLock {
  let tail: Promise<unknown> = Promise.resolve();
  return (run) => {
    const next = tail.then(() => run());
    tail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };
}

export async function commitLockedWrite(input: {
  storage: StorageLike;
  baseRevision: number;
  nextText: string;
  blockWrites?: boolean;
  lock?: StorageLock;
}): Promise<WritePlan> {
  const lock = input.lock ?? browserStorageLock;
  return lock(() => {
    const storedText = input.storage.getItem(WORKSPACE_KEY);
    const decision = planWorkspaceWrite({
      baseRevision: input.baseRevision,
      storedText,
      nextText: input.nextText,
      blockWrites: input.blockWrites,
    });
    if (decision.action === "write")
      input.storage.setItem(WORKSPACE_KEY, decision.text);
    return decision;
  });
}

export function mergeProgress(
  stored: Record<string, ChallengeProgress>,
  local: Record<string, ChallengeProgress>,
): Record<string, ChallengeProgress> {
  const ids = new Set([...Object.keys(stored), ...Object.keys(local)]);
  const next: Record<string, ChallengeProgress> = {};
  for (const id of ids) {
    const previous = stored[id];
    const mine = local[id];
    if (!previous || !mine) {
      const value = previous ?? mine;
      if (value) next[id] = value;
      continue;
    }
    next[id] = {
      submissions: Math.max(previous.submissions, mine.submissions),
      stars: Math.max(previous.stars, mine.stars),
      bestScore: Math.max(previous.bestScore, mine.bestScore),
    };
  }
  return next;
}

function readProgress(
  storage: StorageLike,
  key: string,
): Record<string, ChallengeProgress> {
  try {
    const raw: unknown = JSON.parse(storage.getItem(key) ?? "{}");
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    return raw as Record<string, ChallengeProgress>;
  } catch {
    return {};
  }
}

export async function writeProgress(input: {
  storage: StorageLike;
  local: Record<string, ChallengeProgress>;
  key?: string;
  lock?: StorageLock;
}): Promise<Record<string, ChallengeProgress>> {
  const lock = input.lock ?? browserStorageLock;
  const key = input.key ?? PROGRESS_KEY;
  return lock(() => {
    const merged = mergeProgress(readProgress(input.storage, key), input.local);
    input.storage.setItem(key, JSON.stringify(merged));
    return merged;
  });
}
