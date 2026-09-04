// A dev-server route that hands the browser build the plan `taltree load` made active.
//
// The browser has no filesystem, so the two builds cannot share `tree.yaml` directly.
// This is the whole bridge: a read-only GET, served by the dev server the person
// started on their own machine, that reads the active plan and returns it as JSON. It
// never writes a plan file, and it exists only in dev - a built bundle has no server
// to ask, and browser edits stay in that browser's storage exactly as they do today.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { parse } from "yaml";
import { plansDir, readActivePlan, shortName } from "../bin/lib/plans.mjs";

/** Where the browser build asks. Underscored so it cannot collide with a plan path. */
export const ACTIVE_PLAN_ROUTE = "/__taltree/active-plan";

/** @returns {import("vite").Plugin} */
export function activePlanPlugin() {
  return {
    name: "taltree-active-plan",
    apply: /** @type {const} */ ("serve"),
    configureServer(server) {
      server.middlewares.use(ACTIVE_PLAN_ROUTE, (_request, response) => {
        response.setHeader("content-type", "application/json");
        response.setHeader("cache-control", "no-store");
        try {
          response.end(JSON.stringify(activePlanPayload()));
        } catch (err) {
          response.statusCode = 500;
          response.end(JSON.stringify({ active: null, problem: String(err.message ?? err) }));
        }
      });
    },
  };
}

/** `{ active: null }`, or the active plan's name, path and parsed document. */
export function activePlanPayload(env = process.env, home = homedir()) {
  const active = readActivePlan(env, home);
  if (!active) return { active: null, plansDir: plansDir(env, home) };
  if (!active.exists) {
    return { active: null, plansDir: plansDir(env, home), problem: `${active.path} is no longer there` };
  }
  let plan = null;
  try {
    const text = readFileSync(active.path, "utf8");
    plan = (active.path.toLowerCase().endsWith(".json") ? JSON.parse(text) : parse(text)) ?? null;
  } catch {
    plan = null;
  }
  return {
    active: { name: shortName(basename(active.path)), path: active.path, plan },
    plansDir: plansDir(env, home),
  };
}

function basename(path) {
  const at = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return at === -1 ? path : path.slice(at + 1);
}
