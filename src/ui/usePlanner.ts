import { useCallback, useEffect, useMemo, useState } from "react";
import { demoPlan } from "../demo/seed";
import { systemClock } from "../domain/clock";
import {
  completeNode,
  createNode,
  deferNode,
  deleteNode,
  editNode,
  explainChoice,
  inspect,
  setDailyBudget,
  setTitle,
  undeferNode,
} from "../domain/plan";
import type {
  ChoiceExplanation,
  NodeInput,
  NodeKind,
  NodeListing,
  NodePatch,
  Plan,
  Result,
} from "../domain/types";
import {
  fetchActivePlan,
  readAdopted,
  REPLACED_KEY,
  shouldAdopt,
  writeAdopted,
} from "../persist/activePlan";
import {
  backupBrokenPlan,
  clearBrokenBackup,
  downloadFilename,
  loadBrokenBackup,
  loadPlan,
  parsePlanText,
  savePlan,
  serializePlan,
} from "../persist/storage";

const KIND_ORDER: NodeKind[] = ["eligible", "deferred", "blocked", "completed"];

export function orderedListings(listings: NodeListing[]): NodeListing[] {
  return KIND_ORDER.flatMap((kind) =>
    listings.filter((item) => item.kind === kind),
  );
}

function readInitial(): { plan: Plan; warning: string | null; raw: string | null } {
  const clock = systemClock();
  const loaded = loadPlan(localStorage);
  if (loaded.kind === "ok") {
    return {
      plan: inspect(loaded.plan, clock).plan,
      warning: null,
      raw: loadBrokenBackup(localStorage),
    };
  }
  const demo = inspect(demoPlan(), clock).plan;
  if (loaded.kind === "invalid") {
    backupBrokenPlan(localStorage, loaded.raw);
    return { plan: demo, warning: loaded.message, raw: loaded.raw };
  }
  return { plan: demo, warning: null, raw: loadBrokenBackup(localStorage) };
}

export function usePlanner() {
  const clock = useMemo(() => systemClock(), []);
  const initial = useMemo(() => readInitial(), []);
  const [plan, setPlan] = useState<Plan>(initial.plan);
  const [selectedId, setSelectedId] = useState<string | null>(
    () => inspect(initial.plan, clock).frontier[0]?.node.id ?? initial.plan.nodes[0]?.id ?? null,
  );
  const [error, setError] = useState<string | null>(initial.warning);
  const [brokenRaw, setBrokenRaw] = useState<string | null>(initial.raw);
  const [notice, setNotice] = useState<string | null>(null);

  // The plan `taltree load` made active, taken up once per switch. See
  // `src/persist/activePlan.ts` for why it is once and not on every reload.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const report = await fetchActivePlan();
      if (cancelled) return;
      if (report.kind === "invalid") {
        setError(`The active plan ${report.path} will not load: ${report.message}`);
        return;
      }
      if (report.kind !== "ok") return;
      const { name, plan: incoming } = report.active;
      if (!shouldAdopt(readAdopted(localStorage), name)) return;
      setPlan((current) => {
        // The browser does not write back to the plan file, so the plan being
        // replaced is kept on this device rather than dropped.
        try {
          localStorage.setItem(REPLACED_KEY, serializePlan(current));
        } catch {
          // A browser that refuses storage still gets the plan it asked for.
        }
        return inspect(incoming, clock).plan;
      });
      writeAdopted(localStorage, name);
      setSelectedId(inspect(incoming, clock).frontier[0]?.node.id ?? incoming.nodes[0]?.id ?? null);
      setNotice(`Opened the active plan "${name}". The plan it replaced is kept on this device.`);
    })();
    return () => {
      cancelled = true;
    };
  }, [clock]);

  useEffect(() => {
    const synced = inspect(plan, clock).plan;
    if (synced !== plan) setPlan(synced);
    savePlan(localStorage, synced);
  }, [plan, clock]);

  const view = useMemo(() => inspect(plan, clock), [plan, clock]);
  const listings = useMemo(() => orderedListings(view.listings), [view]);
  const selected =
    listings.find((item) => item.node.id === selectedId) ?? listings[0] ?? null;
  const explanation: ChoiceExplanation | null = useMemo(
    () =>
      selected ? resultValue(explainChoice(view.plan, selected.node.id, clock)) : null,
    [view.plan, selected, clock],
  );

  const commit = useCallback(
    (result: Result<Plan>, nextId?: string | null) => {
      if (!result.ok) {
        setError(result.error.message);
        return false;
      }
      setError(null);
      setPlan(result.value);
      savePlan(localStorage, result.value);
      if (nextId !== undefined) setSelectedId(nextId);
      return true;
    },
    [],
  );

  return {
    clock,
    view,
    plan: view.plan,
    remaining: view.remaining,
    listings,
    selected,
    selectedId: selected?.node.id ?? null,
    explanation,
    error,
    notice,
    brokenRaw,
    select: setSelectedId,
    moveSelection(delta: number) {
      if (listings.length === 0) return;
      const current = selected ? listings.findIndex((item) => item.node.id === selected.node.id) : -1;
      const nextIndex =
        current === -1
          ? delta > 0
            ? 0
            : listings.length - 1
          : (current + delta + listings.length) % listings.length;
      const next = listings[nextIndex];
      if (next) setSelectedId(next.node.id);
    },
    complete() {
      if (!selected) return;
      const before = explainChoice(view.plan, selected.node.id, clock);
      const result = completeNode(view.plan, selected.node.id, clock);
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      const nextView = inspect(result.value, clock);
      const unlocked =
        before.ok
          ? before.value.immediateUnlocks.find((ref) =>
              nextView.frontier.some((item) => item.node.id === ref.id),
            )?.id
          : undefined;
      commit(result, unlocked ?? nextView.frontier[0]?.node.id ?? selected.node.id);
    },
    defer() {
      if (!selected) return;
      commit(deferNode(view.plan, selected.node.id, clock), selected.node.id);
    },
    undefer() {
      if (!selected) return;
      commit(undeferNode(view.plan, selected.node.id, clock), selected.node.id);
    },
    remove() {
      if (!selected) return;
      const id = selected.node.id;
      const result = deleteNode(view.plan, id, clock);
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      const nextView = inspect(result.value, clock);
      commit(
        result,
        nextView.frontier[0]?.node.id ?? nextView.listings[0]?.node.id ?? null,
      );
    },
    create(input: NodeInput) {
      const result = createNode(view.plan, input, clock);
      if (!result.ok) {
        setError(result.error.message);
        return false;
      }
      const created = result.value.nodes[result.value.nodes.length - 1];
      return commit(result, created?.id ?? null);
    },
    edit(patch: NodePatch) {
      if (!selected) return false;
      return commit(editNode(view.plan, selected.node.id, patch, clock), selected.node.id);
    },
    setBudget(value: number) {
      commit(setDailyBudget(view.plan, value, clock));
    },
    setPlanTitle(title: string) {
      commit(setTitle(view.plan, title, clock));
    },
    resetDemo() {
      const next = inspect(demoPlan(), clock).plan;
      clearBrokenBackup(localStorage);
      setBrokenRaw(null);
      commit({ ok: true, value: next }, next.nodes[0]?.id ?? null);
    },
    importText(text: string) {
      const parsed = parsePlanText(text);
      if (!parsed.ok) {
        setError(parsed.error.message);
        return false;
      }
      const next = inspect(parsed.value, clock).plan;
      clearBrokenBackup(localStorage);
      setBrokenRaw(null);
      return commit({ ok: true, value: next }, next.nodes[0]?.id ?? null);
    },
    exportPlan() {
      const blob = new Blob([serializePlan(view.plan)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = downloadFilename(view.plan, clock.today());
      anchor.click();
      URL.revokeObjectURL(url);
    },
    downloadBroken() {
      if (!brokenRaw) return;
      const blob = new Blob([brokenRaw], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "taltree-unreadable-plan.json";
      anchor.click();
      URL.revokeObjectURL(url);
    },
    clearError() {
      setError(null);
    },
    clearNotice() {
      setNotice(null);
    },
  };
}

function resultValue<T>(result: Result<T>): T | null {
  return result.ok ? result.value : null;
}
