import type { ExperimentReport } from "../simulation/experiments";
import type { Trace } from "../simulation/engine";

export function experimentFrames(report: ExperimentReport): Trace[] {
  return report.examples.flatMap((example) => example.trace);
}

export function focusedTransit(event: Trace | undefined):
  | { edge: string; reverse: boolean }
  | undefined {
  if (!event?.edge) return undefined;
  return { edge: event.edge, reverse: Boolean(event.reverse) };
}
