import { parsePlan } from "../domain/parse";
import type { Plan, Result } from "../domain/types";

export const STORAGE_KEY = "taltree.plan.v1";
export const BROKEN_BACKUP_KEY = "taltree.plan.v1.broken";

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

export function backupBrokenPlan(storage: Storage, raw: string): void {
  storage.setItem(BROKEN_BACKUP_KEY, raw);
}

export function loadBrokenBackup(storage: Storage): string | null {
  const raw = storage.getItem(BROKEN_BACKUP_KEY);
  return raw === null || raw === "" ? null : raw;
}

export function clearBrokenBackup(storage: Storage): void {
  storage.removeItem(BROKEN_BACKUP_KEY);
}

export function serializePlan(plan: Plan): string {
  return `${JSON.stringify(plan, omitEmptyOptionals, 2)}\n`;
}

/** Match the TUI: omit the optional fields when empty so an export stays a plain plan. */
function omitEmptyOptionals(key: string, value: unknown): unknown {
  if ((key === "notes" || key === "group") && (value === null || value === "")) {
    return undefined;
  }
  return value;
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
