import { parsePlan } from "../domain/parse";
import type { Plan, Result } from "../domain/types";

export const STORAGE_KEY = "taltree.plan.v1";

export type LoadResult =
  | { kind: "empty" }
  | { kind: "ok"; plan: Plan }
  | { kind: "invalid"; message: string; raw: string };

export function loadPlan(storage: Storage): LoadResult {
  const raw = storage.getItem(STORAGE_KEY);
  if (raw === null || raw === "") return { kind: "empty" };
  try {
    const parsed = parsePlan(JSON.parse(raw) as unknown);
    if (!parsed.ok) {
      return { kind: "invalid", message: parsed.error.message, raw };
    }
    return { kind: "ok", plan: parsed.value };
  } catch {
    return {
      kind: "invalid",
      message: "Saved plan is not valid JSON.",
      raw,
    };
  }
}

export function savePlan(storage: Storage, plan: Plan): void {
  storage.setItem(STORAGE_KEY, serializePlan(plan));
}

export function serializePlan(plan: Plan): string {
  return `${JSON.stringify(plan, null, 2)}\n`;
}

export function parsePlanText(text: string): Result<Plan> {
  try {
    return parsePlan(JSON.parse(text) as unknown);
  } catch {
    return {
      ok: false,
      error: { code: "invalid", message: "That file is not valid JSON." },
    };
  }
}

export function downloadFilename(plan: Plan, today: string): string {
  const slug = plan.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return `taltree-${slug || "plan"}-${today}.json`;
}
