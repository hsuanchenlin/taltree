import { describe, expect, it } from "vitest";
import { demoPlan } from "../demo/seed";
import {
  ACTIVE_PLAN_ROUTE,
  ADOPTED_KEY,
  fetchActivePlan,
  readActivePlanPayload,
  readAdopted,
  shouldAdopt,
  writeAdopted,
} from "./activePlan";

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

const answer = (body: unknown, ok = true) =>
  (async () =>
    ({
      ok,
      json: async () => body,
    }) as unknown as Response) as unknown as typeof fetch;

describe("shouldAdopt", () => {
  it("takes up a plan this browser has not seen yet", () => {
    expect(shouldAdopt(null, "frontend")).toBe(true);
    expect(shouldAdopt("thursday", "frontend")).toBe(true);
  });

  it("leaves the board alone on every reload after that", () => {
    // Re-reading the file each time would throw away work done in the browser,
    // which never writes back to the plan file.
    expect(shouldAdopt("frontend", "frontend")).toBe(false);
  });

  it("does nothing when no plan is active", () => {
    expect(shouldAdopt(null, null)).toBe(false);
    expect(shouldAdopt("frontend", null)).toBe(false);
  });
});

describe("the adopted record", () => {
  it("round-trips through storage and survives a browser that has none", () => {
    const storage = new MemoryStorage();
    expect(readAdopted(storage)).toBeNull();
    writeAdopted(storage, "frontend");
    expect(storage.getItem(ADOPTED_KEY)).toBe("frontend");
    expect(readAdopted(storage)).toBe("frontend");
    expect(readAdopted(null)).toBeNull();
    expect(() => writeAdopted(null, "frontend")).not.toThrow();
  });
});

describe("readActivePlanPayload", () => {
  it("reports no active plan when none is set", () => {
    expect(readActivePlanPayload({ active: null })).toEqual({ kind: "none" });
  });

  it("parses the active plan through the same rules as any other document", () => {
    const report = readActivePlanPayload({
      active: { name: "frontend", path: "/plans/frontend.yaml", plan: demoPlan() },
    });
    expect(report.kind).toBe("ok");
    if (report.kind === "ok") {
      expect(report.active.name).toBe("frontend");
      expect(report.active.plan.nodes.length).toBe(demoPlan().nodes.length);
    }
  });

  it("names a plan that will not load rather than dropping it silently", () => {
    const report = readActivePlanPayload({
      active: { name: "broken", path: "/plans/broken.yaml", plan: { version: 9 } },
    });
    expect(report.kind).toBe("invalid");
    if (report.kind === "invalid") {
      expect(report.path).toBe("/plans/broken.yaml");
      expect(report.message).toContain("version 9");
    }
  });

  it("names a plan whose document could not be parsed at all", () => {
    const report = readActivePlanPayload({
      active: { name: "frontend", path: "/plans/frontend.yaml", plan: null },
    });
    expect(report.kind).toBe("invalid");
    if (report.kind === "invalid") {
      expect(report.name).toBe("frontend");
      expect(report.path).toBe("/plans/frontend.yaml");
    }
  });

  it("treats anything else as no answer at all", () => {
    expect(readActivePlanPayload("nope")).toEqual({ kind: "unavailable" });
    expect(readActivePlanPayload({ active: { name: "x" } })).toEqual({ kind: "unavailable" });
  });
});

describe("fetchActivePlan", () => {
  it("asks the dev server's route", async () => {
    let asked = "";
    const fetcher = (async (input: RequestInfo | URL) => {
      asked = String(input);
      return { ok: true, json: async () => ({ active: null }) } as unknown as Response;
    }) as unknown as typeof fetch;
    expect(await fetchActivePlan(fetcher)).toEqual({ kind: "none" });
    expect(asked).toBe(ACTIVE_PLAN_ROUTE);
  });

  it("stays quiet when there is no dev server behind the route", async () => {
    const dead = (async () => {
      throw new Error("connection refused");
    }) as unknown as typeof fetch;
    expect(await fetchActivePlan(dead)).toEqual({ kind: "unavailable" });
    expect(await fetchActivePlan(answer({}, false))).toEqual({ kind: "unavailable" });
  });

  it("reports an unreadable document instead of treating a 200 as no server", async () => {
    const report = await fetchActivePlan(
      answer({
        active: { name: "frontend", path: "/plans/frontend.yaml", plan: null },
      }),
    );
    expect(report.kind).toBe("invalid");
    if (report.kind === "invalid") {
      expect(report.path).toBe("/plans/frontend.yaml");
    }
  });
});
