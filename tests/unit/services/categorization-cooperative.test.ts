import { describe, it, expect } from "vitest";
import { mapInSlices } from "@/server/services/categorization/cooperative";

function fakeClock() {
  let t = 0;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe("mapInSlices", () => {
  it("maps every slice in order", async () => {
    const out = await mapInSlices([1, 2, 3, 4, 5], (s) => s.map((n) => n * 2), { sliceSize: 2 });
    expect(out).toEqual([[2, 4], [6, 8], [10]]);
  });

  it("pauses once the time budget is spent, then starts a new budget", async () => {
    const clock = fakeClock();
    let pauses = 0;
    await mapInSlices(
      Array.from({ length: 10 }, (_, i) => i),
      (s) => clock.advance(10 * s.length),
      {
        sliceSize: 1,
        budgetMs: 25,
        now: clock.now,
        pause: async () => {
          pauses++;
        },
      },
    );
    // 10 ms per item, 25 ms budget: a pause after every 3rd item.
    expect(pauses).toBe(3);
  });

  it("never pauses while the work stays within budget", async () => {
    let pauses = 0;
    await mapInSlices([1, 2, 3], (s) => s, {
      sliceSize: 1,
      budgetMs: 1_000,
      now: () => 0,
      pause: async () => {
        pauses++;
      },
    });
    expect(pauses).toBe(0);
  });

  it("lets other callbacks run between slices with the default pause", async () => {
    const order: string[] = [];
    let t = 0;
    setImmediate(() => order.push("other"));
    await mapInSlices([1, 2], (s) => order.push(`slice${s[0]}`), {
      sliceSize: 1,
      budgetMs: 1,
      now: () => (t += 5),
    });
    expect(order).toEqual(["slice1", "other", "slice2"]);
  });
});
