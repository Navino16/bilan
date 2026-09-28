import { describe, it, expect } from "vitest";
import { balanceLegend, LEGEND_MAX } from "@/lib/balance-legend";

const acc = (id: string, balance: number) => ({ id, name: id, color: `#${id}`, balance });

describe("balanceLegend", () => {
  it("lists every account, largest first, when they fit", () => {
    const res = balanceLegend([acc("a", 100), acc("b", 300), acc("c", -50)]);
    expect(res.items.map((i) => i.id)).toEqual(["b", "a", "c"]);
    expect(res.others).toBeNull();
    expect(res.positiveTotal).toBe(400);
  });

  it("does not group a single leftover account into « Autres »", () => {
    const accounts = Array.from({ length: LEGEND_MAX + 1 }, (_, i) => acc(`a${i}`, 10 + i));
    const res = balanceLegend(accounts);
    expect(res.items).toHaveLength(LEGEND_MAX + 1);
    expect(res.others).toBeNull();
  });

  it("keeps the top positive balances and groups the rest", () => {
    const accounts = [
      ...Array.from({ length: 7 }, (_, i) => acc(`p${i}`, (i + 1) * 100)),
      acc("neg", -200),
      acc("zero", 0),
    ];
    const res = balanceLegend(accounts);
    expect(res.items.map((i) => i.id)).toEqual(["p6", "p5", "p4", "p3", "p2"]);
    expect(res.others).toEqual({ count: 4, positive: 300 });
    expect(res.positiveTotal).toBe(2800);
  });

  it("never lets a negative balance into the top list", () => {
    const accounts = [acc("a", 50), ...Array.from({ length: 6 }, (_, i) => acc(`n${i}`, -10))];
    const res = balanceLegend(accounts);
    expect(res.items.map((i) => i.id)).toEqual(["a"]);
    expect(res.others).toEqual({ count: 6, positive: 0 });
  });
});
