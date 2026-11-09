import type { Snapshot } from "./engine";

export function clockKey(state: Snapshot): string {
  const now = state.now;
  state.now = 0;
  try {
    return JSON.stringify(state);
  } finally {
    state.now = now;
  }
}

export function slimSnapshot(state: Snapshot): Snapshot {
  if (!state.results.some((result) => result.trace.length)) return state;
  return {
    ...state,
    results: state.results.map((result) =>
      result.trace.length ? { ...result, trace: [] } : result,
    ),
  };
}
