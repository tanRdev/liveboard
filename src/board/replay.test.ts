import { describe, expect, it } from "vitest";
import type { ExperimentReport } from "../simulation/experiments";
import { experimentFrames, focusedTransit } from "./replay";

describe("board replay", () => {
  it("walks example traces in order and keeps the edge direction", () => {
    const report = {
      spec: { name: "Baseline" },
      examples: [
        {
          id: 1,
          status: 200,
          duration: 10,
          trace: [
            { id: 1, request: 1, time: 0, component: "client", text: "GET /users/1", kind: "info", edge: "client-backend" },
            { id: 2, request: 1, time: 20, component: "client", text: "200 OK", kind: "info", edge: "client-backend", reverse: true },
          ],
        },
      ],
    } as ExperimentReport;
    const frames = experimentFrames(report);
    expect(frames.map((frame) => frame.text)).toEqual(["GET /users/1", "200 OK"]);
    expect(focusedTransit(frames[1])).toEqual({
      edge: "client-backend",
      reverse: true,
    });
    expect(focusedTransit(undefined)).toBeUndefined();
  });
});
