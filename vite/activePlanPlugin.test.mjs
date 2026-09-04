import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { plansDir, writeActivePlan } from "../bin/lib/plans.mjs";
import { activePlanPayload } from "./activePlanPlugin.mjs";

const readablePlan = [
  "version: 1",
  "title: Frontend",
  "dailyBudget: 8",
  "activeDate: 2026-09-04",
  "spentToday: 0",
  "nodes:",
  "  - id: a",
  "    title: HTML",
  "    cost: 1",
  "    status: open",
  "",
].join("\n");

let root;
let home;
let env;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "taltree-active-plan-plugin-"));
  home = join(root, "home");
  env = { XDG_CONFIG_HOME: join(root, "xdg") };
  mkdirSync(home, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("activePlanPayload", () => {
  it("returns the parsed document when the active plan is readable", () => {
    const directory = plansDir(env, home);
    mkdirSync(directory, { recursive: true });
    const path = join(directory, "frontend.yaml");
    writeFileSync(path, readablePlan);
    writeActivePlan(path, env, home);

    const payload = activePlanPayload(env, home);
    expect(payload.active).toMatchObject({ name: "frontend", path, plan: { title: "Frontend" } });
  });

  it("still names a syntactically broken active plan so the browser can report it", () => {
    const directory = plansDir(env, home);
    mkdirSync(directory, { recursive: true });
    const path = join(directory, "frontend.yaml");
    writeFileSync(path, "title: Frontend\n  nodes:\n- id: a\n");
    writeActivePlan(path, env, home);

    const payload = activePlanPayload(env, home);
    expect(payload.active).toEqual({ name: "frontend", path, plan: null });
  });

  it("still names a JSON file that will not parse", () => {
    const directory = plansDir(env, home);
    mkdirSync(directory, { recursive: true });
    const path = join(directory, "frontend.json");
    writeFileSync(path, "{");
    writeActivePlan(path, env, home);

    expect(activePlanPayload(env, home).active).toEqual({
      name: "frontend",
      path,
      plan: null,
    });
  });
});
