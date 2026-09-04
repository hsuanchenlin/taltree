import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  activePointerPath,
  clearActivePlan,
  configDir,
  describePlan,
  listPlans,
  planListingLines,
  PlanLibraryError,
  plansDir,
  readActivePlan,
  resolvePlanArgument,
  shortName,
  writeActivePlan,
} from "./plans.mjs";

const planText = (title, ids, groups = {}) =>
  [
    "version: 1",
    `title: ${title}`,
    "dailyBudget: 8",
    "activeDate: 2026-09-04",
    "spentToday: 0",
    "nodes:",
    ...ids.flatMap((id) => [
      `  - id: ${id}`,
      `    title: ${id}`,
      ...(groups[id] ? [`    group: ${groups[id]}`] : []),
      "    cost: 1",
      "    status: open",
    ]),
  ].join("\n") + "\n";

let root;
let home;
let env;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "taltree-plans-"));
  home = join(root, "home");
  env = { XDG_CONFIG_HOME: join(root, "xdg") };
  mkdirSync(home, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("where the library lives", () => {
  it("follows XDG_CONFIG_HOME, then the home directory, the way the Rust build does", () => {
    expect(configDir({ XDG_CONFIG_HOME: "/xdg" }, "/home/person")).toBe("/xdg/taltree");
    expect(configDir({}, "/home/person")).toBe("/home/person/.config/taltree");
    expect(configDir({ XDG_CONFIG_HOME: "  " }, "/home/person")).toBe(
      "/home/person/.config/taltree",
    );
    expect(plansDir({ XDG_CONFIG_HOME: "/xdg" }, "/home/person")).toBe("/xdg/taltree/plans");
    expect(activePointerPath({ XDG_CONFIG_HOME: "/xdg" }, "/home/person")).toBe(
      "/xdg/taltree/active",
    );
  });
});

describe("the active-plan pointer", () => {
  it("reports nothing when no plan has been made active", () => {
    expect(readActivePlan(env, home)).toBeNull();
  });

  it("records an absolute path so a plan anywhere on disk can be the active one", () => {
    const directory = plansDir(env, home);
    mkdirSync(directory, { recursive: true });
    const path = join(directory, "frontend.yaml");
    writeFileSync(path, planText("Frontend", ["a"]));

    writeActivePlan(path, env, home);
    expect(readActivePlan(env, home)).toEqual({ path: resolve(path), exists: true });
  });

  it("says the pointer is stale rather than quietly opening a different plan", () => {
    writeActivePlan(join(root, "gone.yaml"), env, home);
    expect(readActivePlan(env, home)).toEqual({ path: join(root, "gone.yaml"), exists: false });
  });

  it("goes back to no active plan when cleared", () => {
    writeActivePlan(join(root, "gone.yaml"), env, home);
    clearActivePlan(env, home);
    expect(readActivePlan(env, home)).toBeNull();
    // Clearing twice is not an error; the end state is what was asked for.
    expect(() => clearActivePlan(env, home)).not.toThrow();
  });
});

describe("listPlans", () => {
  it("reports an empty library rather than failing when the directory is not there", () => {
    expect(listPlans(join(root, "nothing"))).toEqual([]);
  });

  it("names each plan by its file name without the extension, and counts its nodes", () => {
    const directory = plansDir(env, home);
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, "frontend.yaml"), planText("Frontend Developer", ["a", "b", "c"]));
    writeFileSync(join(directory, "thursday.json"), JSON.stringify({ title: "Thursday", nodes: [{ id: "x" }] }));
    writeFileSync(join(directory, "notes.txt"), "not a plan");
    writeFileSync(join(directory, ".hidden.yaml"), planText("Hidden", ["a"]));

    const entries = listPlans(directory);
    expect(entries.map((entry) => entry.name)).toEqual(["frontend", "thursday"]);
    expect(entries[0]).toMatchObject({
      file: "frontend.yaml",
      readable: true,
      title: "Frontend Developer",
      nodeCount: 3,
      active: false,
    });
    expect(entries[1]).toMatchObject({ readable: true, title: "Thursday", nodeCount: 1 });
  });

  it("marks the active plan", () => {
    const directory = plansDir(env, home);
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, "a.yaml"), planText("A", ["one"]));
    writeFileSync(join(directory, "b.yaml"), planText("B", ["one"]));

    const entries = listPlans(directory, { active: join(directory, "b.yaml") });
    expect(entries.map((entry) => entry.active)).toEqual([false, true]);
  });

  it("keeps a broken file in the listing so the mistake is easy to find", () => {
    const directory = plansDir(env, home);
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, "broken.yaml"), "nodes: [unclosed\n");

    const [entry] = listPlans(directory);
    expect(entry.readable).toBe(false);
    expect(entry.problem).toBeTruthy();
  });

  it("reports the groups a plan names", () => {
    const directory = plansDir(env, home);
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      join(directory, "grouped.yaml"),
      planText("Grouped", ["a", "b", "c"], { a: "Basics", b: "Basics", c: "Advanced" }),
    );
    expect(listPlans(directory)[0].groups).toEqual(["Basics", "Advanced"]);
  });
});

describe("describePlan", () => {
  it("refuses a document that is not a plan instead of reporting zero nodes", () => {
    expect(describePlan("just some text").readable).toBe(false);
    expect(describePlan("version: 1\ntitle: No nodes\n").readable).toBe(false);
    expect(describePlan("[1, 2, 3]").readable).toBe(false);
  });
});

describe("shortName", () => {
  it("drops only a plan extension", () => {
    expect(shortName("frontend.yaml")).toBe("frontend");
    expect(shortName("frontend.yml")).toBe("frontend");
    expect(shortName("frontend.json")).toBe("frontend");
    expect(shortName("my.plan.yaml")).toBe("my.plan");
  });
});

describe("resolvePlanArgument", () => {
  let directory;

  beforeEach(() => {
    directory = plansDir(env, home);
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, "frontend.yaml"), planText("Frontend", ["a"]));
    writeFileSync(join(directory, "thursday.json"), planText("Thursday", ["a"]));
  });

  it("finds a library plan by its short name", () => {
    expect(resolvePlanArgument("frontend", { directory })).toBe(join(directory, "frontend.yaml"));
    expect(resolvePlanArgument("frontend.yaml", { directory })).toBe(join(directory, "frontend.yaml"));
    expect(resolvePlanArgument("thursday", { directory })).toBe(join(directory, "thursday.json"));
  });

  it("takes a path as a path, even when the library holds the same name", () => {
    writeFileSync(join(root, "frontend.yaml"), planText("Elsewhere", ["a"]));
    expect(resolvePlanArgument("./frontend.yaml", { directory, cwd: root })).toBe(
      join(root, "frontend.yaml"),
    );
    expect(resolvePlanArgument(join(root, "frontend.yaml"), { directory, cwd: root })).toBe(
      join(root, "frontend.yaml"),
    );
  });

  it("says what to try next when there is no such plan", () => {
    expect(() => resolvePlanArgument("nope", { directory })).toThrow(/taltree import nope/);
    expect(() => resolvePlanArgument("./nope.yaml", { directory, cwd: root })).toThrow(
      PlanLibraryError,
    );
    expect(() => resolvePlanArgument("  ", { directory })).toThrow(PlanLibraryError);
  });
});

describe("planListingLines", () => {
  it("says where the library is and how to fill it when it is empty", () => {
    const text = planListingLines([], "/plans").join("\n");
    expect(text).toContain("No plans in /plans yet");
    expect(text).toContain("taltree import <slug>");
  });

  it("shows the name, the node count, and which plan is active", () => {
    const text = planListingLines(
      [
        { name: "frontend", readable: true, nodeCount: 120, groups: ["Basics"], title: "Frontend Developer", active: true },
        { name: "thursday", readable: true, nodeCount: 16, groups: [], title: "A full Thursday", active: false },
        { name: "broken", readable: false, problem: "not a Taltree plan: no nodes list", active: false },
      ],
      "/plans",
    ).join("\n");
    expect(text).toContain("* frontend");
    expect(text).toContain("120 nodes, 1 group");
    expect(text).toContain("16 nodes");
    expect(text).toContain("not a Taltree plan");
    expect(text).toContain("taltree load --none");
  });
});
