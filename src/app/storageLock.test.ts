import { describe, expect, it } from "vitest";
import { scenario } from "../board/board";
import { serializeWorkspace, type LocalWorkspace } from "./workspace";
import { WORKSPACE_KEY, type StorageLike } from "./persistence";
import {
  commitLockedWrite,
  createMutex,
  mergeProgress,
  writeProgress,
} from "./storageLock";

function memory(): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, value),
    removeItem: (key) => map.delete(key),
  };
}

function workspace(title: string): LocalWorkspace {
  return { board: { ...scenario("cache"), title }, view: "gallery", revision: 0 };
}

describe("locked workspace writes", () => {
  it("interleaves two writers so the second sees the first revision", async () => {
    const storage = memory();
    const lock = createMutex();
    const [first, second] = await Promise.all([
      commitLockedWrite({
        storage,
        baseRevision: 0,
        nextText: serializeWorkspace(workspace("Tab A")),
        lock,
      }),
      commitLockedWrite({
        storage,
        baseRevision: 0,
        nextText: serializeWorkspace(workspace("Tab B")),
        lock,
      }),
    ]);
    const actions = [first.action, second.action].sort();
    expect(actions).toEqual(["conflict", "write"]);
    const stored = JSON.parse(storage.getItem(WORKSPACE_KEY) ?? "{}") as {
      revision: number;
      board: { title: string };
    };
    expect(stored.revision).toBe(1);
    const winner = [first, second].find((item) => item.action === "write");
    expect(winner && "text" in winner && JSON.parse(winner.text).board.title).toBe(
      stored.board.title,
    );
  });

  it("merges challenge progress from two tabs instead of dropping a star", async () => {
    const storage = memory();
    const lock = createMutex();
    await Promise.all([
      writeProgress({
        storage,
        lock,
        local: { launch: { submissions: 1, stars: 2, bestScore: 80 } },
      }),
      writeProgress({
        storage,
        lock,
        local: { checkout: { submissions: 1, stars: 1, bestScore: 60 } },
      }),
    ]);
    expect(JSON.parse(storage.map.get("liveboard-progress-v1") ?? "{}")).toEqual({
      launch: { submissions: 1, stars: 2, bestScore: 80 },
      checkout: { submissions: 1, stars: 1, bestScore: 60 },
    });
    expect(
      mergeProgress(
        { launch: { submissions: 1, stars: 1, bestScore: 40 } },
        { launch: { submissions: 2, stars: 3, bestScore: 20 } },
      ).launch,
    ).toEqual({ submissions: 2, stars: 3, bestScore: 40 });
  });
});
