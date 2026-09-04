import { parsePlan } from "../domain/parse";
import type { Plan, Result } from "../domain/types";

/**
 * Adopting the plan `taltree load` made active.
 *
 * The dev server publishes the active plan at this route (`vite/activePlanPlugin.mjs`);
 * the browser has no filesystem of its own, so this is the only way the two builds
 * agree on which document is open.
 *
 * The rule that keeps it safe is `shouldAdopt`: a plan is taken up when the person has
 * just switched to a different one, and never again after that. Re-reading the file on
 * every reload would quietly throw away work done in the browser, which does not write
 * back to `tree.yaml`; adopting once means `taltree load frontend` puts frontend on the
 * board, and every reload after it keeps whatever the person did there.
 */
export const ACTIVE_PLAN_ROUTE = "/__taltree/active-plan";

/** The name of the active plan this browser has already taken up. */
export const ADOPTED_KEY = "taltree.activePlan.v1";

/** The plan replaced by an adoption, kept so nothing is lost without a copy. */
export const REPLACED_KEY = "taltree.plan.v1.replaced";

export interface ActivePlan {
  name: string;
  path: string;
  plan: Plan;
}

export type ActivePlanReport =
  | { kind: "none" }
  | { kind: "unavailable" }
  | { kind: "invalid"; name: string; path: string; message: string }
  | { kind: "ok"; active: ActivePlan };

/** True when `incoming` is a plan this browser has not taken up yet. */
export function shouldAdopt(adopted: string | null, incoming: string | null): boolean {
  if (incoming === null) return false;
  return adopted !== incoming;
}

export function readAdopted(storage: Storage | null): string | null {
  if (!storage) return null;
  try {
    const value = storage.getItem(ADOPTED_KEY);
    return value === null || value === "" ? null : value;
  } catch {
    return null;
  }
}

export function writeAdopted(storage: Storage | null, name: string): void {
  try {
    storage?.setItem(ADOPTED_KEY, name);
  } catch {
    // A browser that refuses storage simply offers the active plan again next time.
  }
}

/**
 * Turn the dev server's answer into something the UI can act on.
 *
 * A payload that is not a readable plan is reported rather than thrown away: the file
 * is the person's, and being told which plan will not load is what lets them fix it.
 */
export function readActivePlanPayload(payload: unknown): ActivePlanReport {
  if (!isRecord(payload)) return { kind: "unavailable" };
  const active = payload.active;
  if (active === null || active === undefined) return { kind: "none" };
  if (!isRecord(active) || typeof active.name !== "string" || typeof active.path !== "string") {
    return { kind: "unavailable" };
  }
  const parsed: Result<Plan> = parsePlan(active.plan);
  if (!parsed.ok) {
    return {
      kind: "invalid",
      name: active.name,
      path: active.path,
      message: parsed.error.message,
    };
  }
  return { kind: "ok", active: { name: active.name, path: active.path, plan: parsed.value } };
}

/** Ask the dev server what the active plan is. Never throws; a dead route is "none". */
export async function fetchActivePlan(
  fetcher: typeof fetch = fetch,
): Promise<ActivePlanReport> {
  try {
    const response = await fetcher(ACTIVE_PLAN_ROUTE, {
      headers: { accept: "application/json" },
    });
    if (!response.ok) return { kind: "unavailable" };
    return readActivePlanPayload(await response.json());
  } catch {
    // A production build has no dev server behind this route, and that is fine.
    return { kind: "unavailable" };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
