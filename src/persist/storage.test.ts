import { describe, expect, it } from "vitest";
import { demoPlan } from "../demo/seed";
import { parsePlan } from "../domain/parse";
import { inspect } from "../domain/plan";
import { frozenClock } from "../domain/clock";
import {
  backupBrokenPlan,
  clearBrokenBackup,
  loadBrokenBackup,
  loadPlan,
  parsePlanText,
  savePlan,
  serializePlan,
} from "./storage";

class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length() {
    return this.data.size;
  }
  clear() {
    this.data.clear();
  }
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  key(index: number) {
    return [...this.data.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
}

describe("plan document", () => {
  it("round-trips the demo plan through JSON without uploading it", () => {
    const original = demoPlan();
    const parsed = parsePlan(JSON.parse(serializePlan(original)));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value).toEqual(original);
  });

  it("persists locally through a Storage adapter", () => {
    const storage = new MemoryStorage();
    expect(loadPlan(storage)).toEqual({ kind: "empty" });
    savePlan(storage, demoPlan());
    expect(loadPlan(storage)).toEqual({ kind: "ok", plan: demoPlan() });
  });

  it("keeps the raw text when saved data cannot be parsed", () => {
    const storage = new MemoryStorage();
    storage.setItem("taltree.plan.v1", "{not json");
    const loaded = loadPlan(storage);
    expect(loaded.kind).toBe("invalid");
    if (loaded.kind === "invalid") {
      expect(loaded.raw).toBe("{not json");
      expect(loaded.message).toMatch(/JSON/);
    }
  });

  it("keeps a broken-plan backup retrievable until cleared", () => {
    const storage = new MemoryStorage();
    expect(loadBrokenBackup(storage)).toBeNull();
    backupBrokenPlan(storage, "{not json");
    expect(loadBrokenBackup(storage)).toBe("{not json");
    savePlan(storage, demoPlan());
    expect(loadBrokenBackup(storage)).toBe("{not json");
    clearBrokenBackup(storage);
    expect(loadBrokenBackup(storage)).toBeNull();
  });

  it("rejects imported values beyond the domain bounds", () => {
    const base = JSON.parse(serializePlan(demoPlan())) as Record<string, unknown>;
    const nodes = base.nodes as { cost: number; title: string }[];

    const hugeBudget = parsePlanText(
      JSON.stringify({ ...base, dailyBudget: 100000000 }),
    );
    expect(hugeBudget.ok).toBe(false);
    if (!hugeBudget.ok) expect(hugeBudget.error.message).toContain("0 to 99");

    const hugeCost = parsePlanText(
      JSON.stringify({
        ...base,
        nodes: [{ ...nodes[0], cost: 100 }, ...nodes.slice(1)],
      }),
    );
    expect(hugeCost.ok).toBe(false);
    if (!hugeCost.ok) expect(hugeCost.error.message).toContain("0 to 99");

    const hugeTitle = parsePlanText(
      JSON.stringify({ ...base, title: "t".repeat(201) }),
    );
    expect(hugeTitle.ok).toBe(false);
    if (!hugeTitle.ok) {
      expect(hugeTitle.error.message).toContain("200 characters or fewer");
    }

    const hugeNodeTitle = parsePlanText(
      JSON.stringify({
        ...base,
        nodes: [{ ...nodes[0], title: "t".repeat(201) }, ...nodes.slice(1)],
      }),
    );
    expect(hugeNodeTitle.ok).toBe(false);
    if (!hugeNodeTitle.ok) {
      expect(hugeNodeTitle.error.message).toContain("200 characters or fewer");
    }
  });

  it("rejects a cyclic plan on import with the loop named", () => {
    const result = parsePlanText(
      JSON.stringify({
        version: 1,
        title: "Loop",
        dailyBudget: 8,
        activeDate: "2026-08-27",
        spentToday: 0,
        nodes: [
          {
            id: "a",
            title: "Outline",
            cost: 1,
            status: "open",
            deferredOn: null,
            completedOn: null,
            prerequisiteIds: ["b"],
          },
          {
            id: "b",
            title: "Draft",
            cost: 1,
            status: "open",
            deferredOn: null,
            completedOn: null,
            prerequisiteIds: ["a"],
          },
        ],
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("cycle");
      expect(result.error.message).toContain("→");
    }
  });

  it("rejects a cycle-looking unknown prerequisite on import", () => {
    const result = parsePlanText(
      JSON.stringify({
        version: 1,
        title: "Broken",
        dailyBudget: 8,
        activeDate: "2026-08-27",
        spentToday: 0,
        nodes: [
          {
            id: "a",
            title: "A",
            cost: 1,
            status: "open",
            deferredOn: null,
            completedOn: null,
            prerequisiteIds: ["missing"],
          },
        ],
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("unknown prerequisite");
  });

  it("seeds a frontier with more work than one day's budget", () => {
    const view = inspect(demoPlan(), frozenClock("2026-08-27"));
    expect(view.plan.dailyBudget).toBe(8);
    expect(view.frontier.length).toBeGreaterThan(1);
    const frontierCost = view.frontier.reduce(
      (sum, item) => sum + item.node.cost,
      0,
    );
    expect(frontierCost).toBeGreaterThan(view.plan.dailyBudget);
    expect(view.listings.some((item) => item.kind === "blocked")).toBe(true);
  });
});
