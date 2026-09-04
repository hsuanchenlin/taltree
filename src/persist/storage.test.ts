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

  it("round-trips node notes so a TUI plan does not lose them in the browser", () => {
    const original = demoPlan();
    const first = original.nodes[0];
    if (!first) throw new Error("demo plan has nodes");
    first.notes =
      "Shoebox in the hall cupboard.\n- [@article@The Internet](https://en.wikipedia.org/wiki/Internet)";
    const serialized = serializePlan(original);
    expect(serialized).toContain('"notes":');
    expect(serialized).toContain("The Internet");
    const parsed = parsePlan(JSON.parse(serialized));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.nodes[0]?.notes).toBe(first.notes);
      expect(parsed.value).toEqual(original);
    }
  });

  it("treats missing notes as null and omits them on save", () => {
    const base = JSON.parse(serializePlan(demoPlan())) as {
      nodes: Record<string, unknown>[];
    };
    expect(JSON.stringify(base.nodes[0])).not.toContain("notes");
    const parsed = parsePlanText(JSON.stringify(base));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.nodes[0]?.notes).toBeNull();
      expect(serializePlan(parsed.value)).not.toContain('"notes"');
    }
  });

  it("rejects notes that are not a string", () => {
    const base = JSON.parse(serializePlan(demoPlan())) as {
      nodes: Record<string, unknown>[];
    };
    const result = parsePlanText(
      JSON.stringify({
        ...base,
        nodes: [{ ...base.nodes[0], notes: ["not a string"] }, ...base.nodes.slice(1)],
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("notes");
  });

  it("round-trips a node group so a grouped plan survives the browser", () => {
    const original = demoPlan();
    const first = original.nodes[0];
    if (!first) throw new Error("demo plan has nodes");
    first.group = "Paperwork";
    const serialized = serializePlan(original);
    expect(serialized).toContain('"group": "Paperwork"');
    const parsed = parsePlan(JSON.parse(serialized));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value).toEqual(original);
  });

  it("treats a missing or blank group as none and omits it on save", () => {
    const base = JSON.parse(serializePlan(demoPlan())) as {
      nodes: Record<string, unknown>[];
    };
    expect(JSON.stringify(base.nodes[0])).not.toContain("group");
    const parsed = parsePlanText(
      JSON.stringify({
        ...base,
        nodes: [{ ...base.nodes[0], group: "   " }, ...base.nodes.slice(1)],
      }),
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.nodes[0]?.group).toBeNull();
      expect(serializePlan(parsed.value)).not.toContain('"group"');
    }
  });

  it("rejects a group that is not a string", () => {
    const base = JSON.parse(serializePlan(demoPlan())) as {
      nodes: Record<string, unknown>[];
    };
    const result = parsePlanText(
      JSON.stringify({
        ...base,
        nodes: [{ ...base.nodes[0], group: 7 }, ...base.nodes.slice(1)],
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("group");
  });

  it("reads a tree.json written by the TUI, which omits its empty fields", () => {
    // The Rust build skips serialising `deferredOn`, `completedOn` and an empty
    // `prerequisiteIds`, so a plan exported from the terminal has to read here.
    const result = parsePlanText(
      JSON.stringify({
        version: 1,
        title: "A full Thursday",
        dailyBudget: 8,
        activeDate: "2026-08-31",
        spentToday: 0,
        nodes: [
          { id: "receipts", title: "Find receipts", cost: 2, status: "open" },
          {
            id: "tax",
            title: "File the tax packet",
            group: "Paperwork",
            cost: 5,
            status: "open",
            prerequisiteIds: ["receipts"],
          },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.nodes[0]).toEqual({
        id: "receipts",
        title: "Find receipts",
        group: null,
        cost: 2,
        status: "open",
        deferredOn: null,
        completedOn: null,
        prerequisiteIds: [],
        notes: null,
      });
      expect(result.value.nodes[1]?.group).toBe("Paperwork");
    }
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
