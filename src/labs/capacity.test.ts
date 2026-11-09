import { describe, expect, it } from "vitest";
import { capacityHint, missBudgetMs } from "./capacity";

describe("traffic capacity hint", () => {
  it("warns when the slider is faster than one slot can finish a miss", () => {
    const missMs = missBudgetMs(600);
    expect(missMs).toBe(880);
    const calm = capacityHint({
      rate: 1,
      concurrency: 1,
      queue: 0,
      queueLimit: 50,
      missMs,
    });
    expect(calm.over).toBe(false);
    expect(calm.text).toContain("1 req/s fits");
    const queued = capacityHint({
      rate: 5,
      concurrency: 1,
      queue: 8,
      queueLimit: 50,
      missMs,
    });
    expect(queued.over).toBe(true);
    expect(queued.text).toContain("queue grows before anything fails");
    expect(queued.text).toContain("Waiting 8 of 50");
  });
});
