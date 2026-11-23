import { describe, it, expect } from "vitest";
import { balanceLegend, balanceSegments, LEGEND_MAX } from "@/lib/balance-legend";

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
    expect(res.others).toEqual({ count: 4, positive: 300, negative: 200 });
    expect(res.positiveTotal).toBe(2800);
    expect(res.negativeTotal).toBe(200);
  });

  it("never lets a negative balance into the top list", () => {
    const accounts = [acc("a", 50), ...Array.from({ length: 6 }, (_, i) => acc(`n${i}`, -10))];
    const res = balanceLegend(accounts);
    expect(res.items.map((i) => i.id)).toEqual(["a"]);
    expect(res.others).toEqual({ count: 6, positive: 0, negative: 60 });
  });
});

describe("balanceSegments", () => {
  const shares = (segments: ReturnType<typeof balanceSegments>) =>
    segments.map((s) => [s.id, s.negative, Math.round(s.share * 100)]);

  it("splits the bar between assets and debts, debts last", () => {
    const res = balanceSegments(balanceLegend([acc("a", 300), acc("c", -100), acc("b", 100)]));
    expect(shares(res)).toEqual([
      ["a", false, 60],
      ["b", false, 20],
      ["c", true, 20],
    ]);
  });

  it("shows a negative total as a mostly-debt bar", () => {
    const res = balanceSegments(balanceLegend([acc("a", 100), acc("b", -300)]));
    expect(shares(res)).toEqual([
      ["a", false, 25],
      ["b", true, 75],
    ]);
  });

  it("keeps an all-negative set of accounts on the bar", () => {
    const res = balanceSegments(balanceLegend([acc("a", -50), acc("b", -50)]));
    expect(shares(res)).toEqual([
      ["a", true, 50],
      ["b", true, 50],
    ]);
  });

  it("folds grouped debts into a negative « Autres » segment", () => {
    const accounts = [...Array.from({ length: 6 }, (_, i) => acc(`p${i}`, 100)), acc("neg", -200)];
    const res = balanceSegments(balanceLegend(accounts));
    expect(res.at(-2)).toMatchObject({ id: "others", negative: false });
    expect(res.at(-1)).toMatchObject({ id: "others", negative: true, share: 0.25 });
    expect(res.reduce((sum, s) => sum + s.share, 0)).toBeCloseTo(1);
  });

  it("draws nothing when every balance is zero", () => {
    expect(balanceSegments(balanceLegend([acc("a", 0)]))).toEqual([]);
  });
});
