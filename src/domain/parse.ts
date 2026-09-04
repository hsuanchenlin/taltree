import { cycleIfAdded, MAX_BUDGET, MAX_COST, MAX_TITLE } from "./plan";
import type { NodeStatus, Plan, PlanNode, Result } from "./types";

export function parsePlan(data: unknown): Result<Plan> {
  if (!isRecord(data)) {
    return fail("Plan data must be a JSON object.");
  }
  if (data.version !== 1) {
    return fail(
      `Unsupported plan version ${String(data.version)}. Taltree Slice 0 reads version 1.`,
    );
  }
  if (typeof data.title !== "string" || !data.title.trim()) {
    return fail("Plan title must be a non-empty string.");
  }
  if (data.title.trim().length > MAX_TITLE) {
    return fail(`Plan title must be ${MAX_TITLE} characters or fewer.`);
  }
  if (
    typeof data.dailyBudget !== "number" ||
    !Number.isInteger(data.dailyBudget) ||
    data.dailyBudget < 0 ||
    data.dailyBudget > MAX_BUDGET
  ) {
    return fail(`dailyBudget must be a whole number from 0 to ${MAX_BUDGET}.`);
  }
  if (typeof data.activeDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(data.activeDate)) {
    return fail("activeDate must be a YYYY-MM-DD date.");
  }
  if (
    typeof data.spentToday !== "number" ||
    !Number.isInteger(data.spentToday) ||
    data.spentToday < 0
  ) {
    return fail("spentToday must be a whole number of 0 or more.");
  }
  if (!Array.isArray(data.nodes)) {
    return fail("nodes must be an array.");
  }

  const nodes: PlanNode[] = [];
  const ids = new Set<string>();
  for (const item of data.nodes) {
    const node = parseNode(item);
    if (!node.ok) return node;
    if (ids.has(node.value.id)) {
      return fail(`Duplicate node id "${node.value.id}".`);
    }
    ids.add(node.value.id);
    nodes.push(node.value);
  }

  for (const node of nodes) {
    for (const prereqId of node.prerequisiteIds) {
      if (!ids.has(prereqId)) {
        return fail(
          `"${node.title}" lists unknown prerequisite "${prereqId}".`,
        );
      }
    }
  }

  const plan: Plan = {
    version: 1,
    title: data.title.trim(),
    dailyBudget: data.dailyBudget,
    activeDate: data.activeDate,
    spentToday: data.spentToday,
    nodes,
  };

  for (const node of nodes) {
    for (const prereqId of node.prerequisiteIds) {
      const cycle = cycleIfAdded(plan, node.id, prereqId);
      if (cycle) return { ok: false, error: cycle };
    }
  }

  return { ok: true, value: plan };
}

function parseNode(data: unknown): Result<PlanNode> {
  if (!isRecord(data)) return fail("Each node must be a JSON object.");
  if (typeof data.id !== "string" || !data.id) {
    return fail("Each node needs a non-empty id.");
  }
  if (typeof data.title !== "string" || !data.title.trim()) {
    return fail("Each node needs a non-empty title.");
  }
  if (data.title.trim().length > MAX_TITLE) {
    return fail(`Node titles must be ${MAX_TITLE} characters or fewer.`);
  }
  if (
    typeof data.cost !== "number" ||
    !Number.isInteger(data.cost) ||
    data.cost < 0 ||
    data.cost > MAX_COST
  ) {
    return fail(
      `Node "${data.title}" cost must be a whole number from 0 to ${MAX_COST}.`,
    );
  }
  const status = parseStatus(data.status);
  if (!status.ok) return status;
  // The TUI omits an optional field rather than writing `null`, so a `tree.json`
  // written by that build has to read here as the absent field it is.
  const deferredOn = data.deferredOn ?? null;
  const completedOn = data.completedOn ?? null;
  if (deferredOn !== null && typeof deferredOn !== "string") {
    return fail(`Node "${data.title}" deferredOn must be a date or null.`);
  }
  if (completedOn !== null && typeof completedOn !== "string") {
    return fail(`Node "${data.title}" completedOn must be a date or null.`);
  }
  const declaredPrereqs = data.prerequisiteIds ?? [];
  if (!Array.isArray(declaredPrereqs)) {
    return fail(`Node "${data.title}" prerequisiteIds must be an array of ids.`);
  }
  const prerequisiteIds: string[] = [];
  for (const id of declaredPrereqs) {
    if (typeof id !== "string" || !id) {
      return fail(`Node "${data.title}" prerequisiteIds must be an array of ids.`);
    }
    if (!prerequisiteIds.includes(id)) prerequisiteIds.push(id);
  }
  const notes = parseNotesField(data.notes, data.title);
  if (!notes.ok) return notes;
  const group = parseGroupField(data.group, data.title);
  if (!group.ok) return group;
  return {
    ok: true,
    value: {
      id: data.id,
      title: data.title.trim(),
      group: group.value,
      cost: data.cost,
      status: status.value,
      deferredOn,
      completedOn,
      prerequisiteIds,
      notes: notes.value,
    },
  };
}

/** A group is a label, not a schema of its own; blank means none. */
function parseGroupField(value: unknown, title: unknown): Result<string | null> {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== "string") {
    return fail(`Node "${String(title)}" group must be a string or null.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > MAX_TITLE) {
    return fail(`Node "${String(title)}" group must be ${MAX_TITLE} characters or fewer.`);
  }
  return { ok: true, value: trimmed ? trimmed : null };
}

function parseNotesField(value: unknown, title: unknown): Result<string | null> {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== "string") {
    return fail(`Node "${String(title)}" notes must be a string or null.`);
  }
  const trimmed = value.trim();
  return { ok: true, value: trimmed ? value : null };
}

function parseStatus(value: unknown): Result<NodeStatus> {
  if (value === "open" || value === "completed") return { ok: true, value };
  return fail(`Node status must be "open" or "completed".`);
}

function isRecord(data: unknown): data is Record<string, unknown> {
  return typeof data === "object" && data !== null && !Array.isArray(data);
}

function fail(message: string): Result<never> {
  return { ok: false, error: { code: "invalid", message } };
}
