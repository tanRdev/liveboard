import { describe, expect, it } from "vitest";
import { scenario } from "../board/board";
import {
  parseWorkspace,
  serializeWorkspace,
  type LocalWorkspace,
} from "./workspace";
import {
  RECOVERY_KEY,
  RECOVERY_PREVIOUS_KEY,
  WORKSPACE_KEY,
  discardRecovery,
  loadStoredWorkspace,
  planWorkspaceWrite,
  recoveryText,
  workspaceContent,
  type StorageLike,
} from "./persistence";

function memory(): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, value),
    removeItem: (key) => map.delete(key),
  };
}
function workspace(patch: Partial<LocalWorkspace> = {}): LocalWorkspace {
  return {
    board: scenario("cache"),
    view: "gallery",
    revision: 0,
    ...patch,
  };
}

describe("workspace persistence", () => {
  it("does not rewrite an unchanged document or replace a newer tab", () => {
    const stored = serializeWorkspace(workspace({ revision: 4 }));
    expect(
      planWorkspaceWrite({
        baseRevision: 4,
        storedText: stored,
        nextText: serializeWorkspace(workspace({ revision: 4 })),
      }),
    ).toEqual({ action: "adopt", revision: 4 });
    const newer = serializeWorkspace(
      workspace({
        revision: 5,
        board: { ...scenario("cache"), title: "Other tab" },
      }),
    );
    const conflict = planWorkspaceWrite({
      baseRevision: 4,
      storedText: newer,
      nextText: serializeWorkspace(
        workspace({
          revision: 4,
          board: { ...scenario("cache"), title: "This tab" },
        }),
      ),
    });
    expect(conflict).toMatchObject({ action: "conflict", storedRevision: 5 });
    const kept = planWorkspaceWrite({
      baseRevision: 5,
      storedText: newer,
      nextText: serializeWorkspace(
        workspace({
          revision: 5,
          board: { ...scenario("cache"), title: "This tab" },
        }),
      ),
    });
    expect(kept.action).toBe("write");
    if (kept.action === "write") {
      expect(kept.revision).toBe(6);
      expect(parseWorkspace(kept.text).board.title).toBe("This tab");
    }
  });
  it("treats node movement as the same workspace content", () => {
    const board = scenario("cache");
    const moved = structuredClone(board);
    moved.nodes[0].position = { x: 40, y: 80 };
    expect(workspaceContent(serializeWorkspace(workspace({ board })))).toBe(
      workspaceContent(serializeWorkspace(workspace({ board: moved }))),
    );
  });
  it("adopts the same board saved by another tab without writing over it", () => {
    const board = scenario("cache");
    const stored = serializeWorkspace(workspace({ board, revision: 7 }));
    expect(
      planWorkspaceWrite({
        baseRevision: 6,
        storedText: stored,
        nextText: serializeWorkspace(workspace({ board, revision: 6 })),
      }),
    ).toEqual({ action: "adopt", revision: 7 });
  });
  it("refuses to replace unreadable storage and keeps a recoverable copy", () => {
    const store = memory();
    store.setItem(WORKSPACE_KEY, "{");
    const loaded = loadStoredWorkspace(store, 1000);
    expect(loaded).toMatchObject({ status: "unreadable", preserved: true });
    expect(store.getItem(WORKSPACE_KEY)).toBe("{");
    expect(recoveryText(store.getItem(RECOVERY_KEY))).toBe("{");
    const replaced = planWorkspaceWrite({
      baseRevision: 0,
      storedText: "{",
      nextText: serializeWorkspace(workspace()),
    });
    expect(replaced.action).toBe("write");
    if (replaced.action === "write") {
      expect(replaced.revision).toBe(1);
      expect(parseWorkspace(replaced.text).board.title).toBe("User profile API");
    }
    const blocked = memory();
    blocked.setItem = () => {
      throw new Error("quota");
    };
    blocked.map.set(WORKSPACE_KEY, "{not json");
    const blockedLoad = loadStoredWorkspace(blocked);
    expect(blockedLoad.status).toBe("unreadable");
    if (blockedLoad.status === "unreadable")
      expect(blockedLoad.preserved).toBe(false);
    expect(
      planWorkspaceWrite({
        baseRevision: 0,
        storedText: null,
        nextText: serializeWorkspace(workspace()),
        blockWrites: true,
      }).action,
    ).toBe("refuse");
  });
  it("keeps the previous recovery when a second unreadable document appears", () => {
    const store = memory();
    store.setItem(WORKSPACE_KEY, "{first");
    expect(loadStoredWorkspace(store, 1).status).toBe("unreadable");
    store.setItem(WORKSPACE_KEY, "{second");
    expect(loadStoredWorkspace(store, 2).status).toBe("unreadable");
    expect(recoveryText(store.getItem(RECOVERY_KEY))).toBe("{second");
    expect(recoveryText(store.getItem(RECOVERY_PREVIOUS_KEY))).toBe("{first");
    discardRecovery(store);
    expect(store.getItem(RECOVERY_KEY)).toBeNull();
    expect(store.getItem(RECOVERY_PREVIOUS_KEY)).toBeNull();
  });
  it("still loads a legacy board file stored before workspace revisions", () => {
    const store = memory();
    const board = scenario("balanced");
    store.setItem(
      WORKSPACE_KEY,
      JSON.stringify(JSON.parse(serializeWorkspace(workspace({ board }))).board),
    );
    const loaded = loadStoredWorkspace(store);
    expect(loaded.status).toBe("ok");
    if (loaded.status === "ok")
      expect(loaded.workspace.board.title).toBe(board.title);
  });
});
