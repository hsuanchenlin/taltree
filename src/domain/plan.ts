import type {
  BlockedDependent,
  ChoiceExplanation,
  Clock,
  NamedRef,
  NodeInput,
  NodeKind,
  NodeListing,
  NodePatch,
  Plan,
  PlanError,
  PlanNode,
  PlanView,
  Result,
} from "./types";

export const MAX_TITLE = 200;
export const MAX_COST = 99;
export const MAX_BUDGET = 99;

export function emptyPlan(clock: Clock, title = "Untitled plan"): Plan {
  return {
    version: 1,
    title: title.trim() || "Untitled plan",
    dailyBudget: 8,
    activeDate: clock.today(),
    spentToday: 0,
    nodes: [],
  };
}

export function syncDay(plan: Plan, clock: Clock): Plan {
  const today = clock.today();
  if (plan.activeDate === today) return plan;
  return { ...plan, activeDate: today, spentToday: 0 };
}

export function remainingBudget(plan: Plan): number {
  return Math.max(0, plan.dailyBudget - plan.spentToday);
}

export function inspect(plan: Plan, clock: Clock): PlanView {
  const synced = syncDay(plan, clock);
  const remaining = remainingBudget(synced);
  const listings = synced.nodes.map((node) =>
    listingFor(synced, node, remaining, clock),
  );
  return {
    plan: synced,
    remaining,
    listings,
    frontier: listings.filter((item) => item.kind === "eligible"),
  };
}

export function explainChoice(
  plan: Plan,
  nodeId: string,
  clock: Clock,
): Result<ChoiceExplanation> {
  const synced = syncDay(plan, clock);
  const node = findNode(synced, nodeId);
  if (!node) return notFound(nodeId);

  const remaining = remainingBudget(synced);
  const waitingOn = openPrereqs(synced, node);
  const deferredToday = isDeferredToday(node, clock);
  const completed = node.status === "completed";
  const eligible =
    !completed && !deferredToday && waitingOn.length === 0;
  const overBy = Math.max(0, node.cost - remaining);

  const immediateUnlocks: NamedRef[] = [];
  const stillBlockedDependents: BlockedDependent[] = [];
  for (const dependent of dependentsOf(synced, node.id)) {
    if (dependent.status === "completed") continue;
    const waitingAfter = openPrereqs(synced, dependent).filter(
      (ref) => ref.id !== node.id,
    );
    const named = refOf(dependent);
    if (waitingAfter.length === 0) immediateUnlocks.push(named);
    else stillBlockedDependents.push({ ...named, waitingOn: waitingAfter });
  }

  return ok({
    node,
    cost: node.cost,
    remainingBudget: remaining,
    fitsBudget: node.cost <= remaining,
    overBy,
    immediateUnlocks,
    stillBlockedDependents,
    waitingOn,
    eligible,
    deferredToday,
    completed,
  });
}

export function createNode(
  plan: Plan,
  input: NodeInput,
  clock: Clock,
  idFactory: () => string = createNodeId,
): Result<Plan> {
  const synced = syncDay(plan, clock);
  const parsed = parseNodeFields(input.title, input.cost);
  if (!parsed.ok) return parsed;
  const prerequisiteIds = input.prerequisiteIds ?? [];
  const prereqCheck = validatePrereqs(synced, "new-node", prerequisiteIds);
  if (!prereqCheck.ok) return prereqCheck;

  const node: PlanNode = {
    id: idFactory(),
    title: parsed.value.title,
    cost: parsed.value.cost,
    status: "open",
    deferredOn: null,
    completedOn: null,
    prerequisiteIds: unique(prerequisiteIds),
  };
  return ok({ ...synced, nodes: [...synced.nodes, node] });
}

export function editNode(
  plan: Plan,
  nodeId: string,
  patch: NodePatch,
  clock: Clock,
): Result<Plan> {
  const synced = syncDay(plan, clock);
  const node = findNode(synced, nodeId);
  if (!node) return notFound(nodeId);

  const title = patch.title === undefined ? node.title : patch.title;
  const cost = patch.cost === undefined ? node.cost : patch.cost;
  const parsed = parseNodeFields(title, cost);
  if (!parsed.ok) return parsed;

  const prerequisiteIds =
    patch.prerequisiteIds === undefined
      ? node.prerequisiteIds
      : unique(patch.prerequisiteIds);
  const prereqCheck = validatePrereqs(synced, nodeId, prerequisiteIds);
  if (!prereqCheck.ok) return prereqCheck;

  return ok(replaceNode(synced, { ...node, ...parsed.value, prerequisiteIds }));
}

export function completeNode(
  plan: Plan,
  nodeId: string,
  clock: Clock,
): Result<Plan> {
  const synced = syncDay(plan, clock);
  const node = findNode(synced, nodeId);
  if (!node) return notFound(nodeId);
  if (node.status === "completed") {
    return fail("invalid", `"${node.title}" is already completed.`);
  }
  const waitingOn = openPrereqs(synced, node);
  if (waitingOn.length > 0) {
    return {
      ok: false,
      error: {
        code: "blocked",
        message: blockedMessage(node.title, waitingOn),
        waitingOn,
      },
    };
  }
  const completed: PlanNode = {
    ...node,
    status: "completed",
    completedOn: clock.today(),
    deferredOn: null,
  };
  return ok({
    ...replaceNode(synced, completed),
    spentToday: synced.spentToday + node.cost,
  });
}

export function deferNode(
  plan: Plan,
  nodeId: string,
  clock: Clock,
): Result<Plan> {
  const synced = syncDay(plan, clock);
  const node = findNode(synced, nodeId);
  if (!node) return notFound(nodeId);
  if (node.status === "completed") {
    return fail("invalid", `Completed work cannot be deferred.`);
  }
  return ok(
    replaceNode(synced, { ...node, deferredOn: clock.today() }),
  );
}

export function undeferNode(
  plan: Plan,
  nodeId: string,
  clock: Clock,
): Result<Plan> {
  const synced = syncDay(plan, clock);
  const node = findNode(synced, nodeId);
  if (!node) return notFound(nodeId);
  return ok(replaceNode(synced, { ...node, deferredOn: null }));
}

export function deleteNode(
  plan: Plan,
  nodeId: string,
  clock: Clock,
): Result<Plan> {
  const synced = syncDay(plan, clock);
  const node = findNode(synced, nodeId);
  if (!node) return notFound(nodeId);
  return ok({
    ...synced,
    nodes: synced.nodes
      .filter((item) => item.id !== nodeId)
      .map((item) => ({
        ...item,
        prerequisiteIds: item.prerequisiteIds.filter((id) => id !== nodeId),
      })),
  });
}

export function setDailyBudget(
  plan: Plan,
  dailyBudget: number,
  clock: Clock,
): Result<Plan> {
  const synced = syncDay(plan, clock);
  if (!Number.isInteger(dailyBudget) || dailyBudget < 0 || dailyBudget > MAX_BUDGET) {
    return fail(
      "invalid",
      `Daily budget must be a whole number from 0 to ${MAX_BUDGET}.`,
    );
  }
  return ok({ ...synced, dailyBudget });
}

export function setTitle(plan: Plan, title: string, clock: Clock): Result<Plan> {
  const synced = syncDay(plan, clock);
  const trimmed = title.trim();
  if (!trimmed) return fail("invalid", "Plan title cannot be empty.");
  if (trimmed.length > MAX_TITLE) {
    return fail("invalid", `Plan title must be ${MAX_TITLE} characters or fewer.`);
  }
  return ok({ ...synced, title: trimmed });
}

export function cycleIfAdded(
  plan: Plan,
  dependentId: string,
  prerequisiteId: string,
): PlanError | null {
  if (dependentId === prerequisiteId) {
    const node = findNode(plan, dependentId);
    const title = node?.title ?? "this node";
    return {
      code: "cycle",
      message: `"${title}" cannot be a prerequisite of itself.`,
      path: [dependentId],
    };
  }
  const dependent = findNode(plan, dependentId);
  const prerequisite = findNode(plan, prerequisiteId);
  if (!dependent || !prerequisite) return null;
  const path = pathFrom(plan, dependentId, prerequisiteId);
  if (!path) return null;
  const cycle = [prerequisiteId, ...path];
  const titles = cycle.map((id) => findNode(plan, id)?.title ?? id);
  return {
    code: "cycle",
    message: `Adding "${prerequisite.title}" as a prerequisite of "${dependent.title}" would create a cycle: ${titles.join(" → ")}.`,
    path: cycle,
  };
}

function listingFor(
  plan: Plan,
  node: PlanNode,
  remaining: number,
  clock: Clock,
): NodeListing {
  const waitingOn = openPrereqs(plan, node);
  const kind = kindOf(node, waitingOn, clock);
  return {
    node,
    kind,
    waitingOn,
    exceedsBudget: kind === "eligible" && node.cost > remaining,
  };
}

function kindOf(
  node: PlanNode,
  waitingOn: NamedRef[],
  clock: Clock,
): NodeKind {
  if (node.status === "completed") return "completed";
  if (isDeferredToday(node, clock)) return "deferred";
  if (waitingOn.length > 0) return "blocked";
  return "eligible";
}

function isDeferredToday(node: PlanNode, clock: Clock): boolean {
  return node.deferredOn === clock.today();
}

function openPrereqs(plan: Plan, node: PlanNode): NamedRef[] {
  const refs: NamedRef[] = [];
  for (const id of node.prerequisiteIds) {
    const prereq = findNode(plan, id);
    if (prereq && prereq.status !== "completed") refs.push(refOf(prereq));
  }
  return refs;
}

function dependentsOf(plan: Plan, nodeId: string): PlanNode[] {
  return plan.nodes.filter((node) => node.prerequisiteIds.includes(nodeId));
}

function validatePrereqs(
  plan: Plan,
  dependentId: string,
  prerequisiteIds: string[],
): Result<true> {
  for (const id of prerequisiteIds) {
    if (!findNode(plan, id)) {
      return fail("not-found", `Unknown prerequisite "${id}".`, id);
    }
    if (dependentId !== "new-node") {
      const cycle = cycleIfAdded(plan, dependentId, id);
      if (cycle) return { ok: false, error: cycle };
    }
  }
  return ok(true);
}

function pathFrom(plan: Plan, fromId: string, toId: string): string[] | null {
  const adj = dependentAdjacency(plan);
  const parent = new Map<string, string | null>();
  parent.set(fromId, null);
  const queue = [fromId];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    for (const next of adj.get(current) ?? []) {
      if (parent.has(next)) continue;
      parent.set(next, current);
      if (next === toId) return reconstruct(parent, fromId, toId);
      queue.push(next);
    }
  }
  return null;
}

function reconstruct(
  parent: Map<string, string | null>,
  fromId: string,
  toId: string,
): string[] {
  const path = [toId];
  let cursor: string | null = toId;
  while (cursor !== fromId) {
    cursor = parent.get(cursor) ?? null;
    if (cursor === null) break;
    path.push(cursor);
  }
  path.reverse();
  return path;
}

function dependentAdjacency(plan: Plan): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const node of plan.nodes) adj.set(node.id, []);
  for (const node of plan.nodes) {
    for (const prereqId of node.prerequisiteIds) {
      const list = adj.get(prereqId);
      if (list) list.push(node.id);
    }
  }
  return adj;
}

function parseNodeFields(
  title: string,
  cost: number,
): Result<{ title: string; cost: number }> {
  const trimmed = title.trim();
  if (!trimmed) return fail("invalid", "Node title cannot be empty.");
  if (trimmed.length > MAX_TITLE) {
    return fail("invalid", `Node title must be ${MAX_TITLE} characters or fewer.`);
  }
  if (!Number.isInteger(cost) || cost < 0 || cost > MAX_COST) {
    return fail(
      "invalid",
      `Cost must be a whole number from 0 to ${MAX_COST} points.`,
    );
  }
  return ok({ title: trimmed, cost });
}

function findNode(plan: Plan, nodeId: string): PlanNode | undefined {
  return plan.nodes.find((node) => node.id === nodeId);
}

function replaceNode(plan: Plan, node: PlanNode): Plan {
  return {
    ...plan,
    nodes: plan.nodes.map((item) => (item.id === node.id ? node : item)),
  };
}

function refOf(node: PlanNode): NamedRef {
  return { id: node.id, title: node.title };
}

function unique(ids: string[]): string[] {
  return [...new Set(ids)];
}

function createNodeId(): string {
  return `n_${crypto.randomUUID()}`;
}

function blockedMessage(title: string, waitingOn: NamedRef[]): string {
  const names = waitingOn.map((ref) => `"${ref.title}"`).join(", ");
  return `Cannot complete "${title}" yet. Waiting on ${names}.`;
}

function notFound(nodeId: string): Result<never> {
  return fail("not-found", `No node with id "${nodeId}".`, nodeId);
}

function fail(code: PlanError["code"], message: string, nodeId?: string): Result<never> {
  return { ok: false, error: { code, message, nodeId } };
}

function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}
