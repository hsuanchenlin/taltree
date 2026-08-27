import { describe, expect, it } from "vitest";
import { demoPlan } from "../demo/seed";
import { frozenClock } from "../domain/clock";
import {
  completeNode,
  createNode,
  deferNode,
  explainChoice,
  inspect,
  setDailyBudget,
} from "../domain/plan";
import type { Clock, Plan, Result } from "../domain/types";
import { projectGraph } from "./project";

const TODAY = "2026-08-27";
const clock = frozenClock(TODAY);

describe("graph projection state mapping", () => {
  it("maps inspect kinds onto nodes without inventing eligibility", () => {
    let plan = chain(clock);
    plan = unwrap(completeNode(plan, byTitle(plan, "Draft").id, clock));
    plan = unwrap(deferNode(plan, byTitle(plan, "Walk-through").id, clock));
    const view = inspect(plan, clock);
    const graph = projectGraph(view);

    expect(byId(graph.nodes, "draft").kind).toBe("completed");
    expect(byId(graph.nodes, "review").kind).toBe("deferred");
    expect(byId(graph.nodes, "send").kind).toBe("blocked");
    expect(byId(graph.nodes, "send").waitingOn.map((ref) => ref.title)).toEqual([
      "Walk-through",
    ]);
    expect(byId(graph.nodes, "send").caption).toBe("Waiting on Walk-through");
    expect(byId(graph.nodes, "send").captionTone).toBe("blocked");
  });

  it("marks the selected node and the dependents it would immediately unlock", () => {
    const plan = chain(clock);
    const view = inspect(plan, clock);
    const draft = byTitle(plan, "Draft");
    const explained = unwrap(explainChoice(view.plan, draft.id, clock));
    const graph = projectGraph(view, {
      selectedId: draft.id,
      immediateUnlockIds: explained.immediateUnlocks.map((ref) => ref.id),
    });

    expect(byId(graph.nodes, "draft").selected).toBe(true);
    expect(byId(graph.nodes, "review").unlocksIfCompleted).toBe(true);
    expect(byId(graph.nodes, "review").caption).toBe("Unlocks next");
    expect(byId(graph.nodes, "review").captionTone).toBe("unlock");
    expect(byId(graph.nodes, "send").unlocksIfCompleted).toBe(false);
    expect(edge(graph.edges, "draft", "review").kind).toBe("unlock");
    expect(edge(graph.edges, "review", "send").kind).toBe("blocking");
  });

  it("draws ready edges from completed prerequisites and blocking edges from open ones", () => {
    let plan = diamond(clock);
    plan = unwrap(completeNode(plan, byTitle(plan, "Outline").id, clock));
    const view = inspect(plan, clock);
    const graph = projectGraph(view);

    expect(edge(graph.edges, "outline", "slides").kind).toBe("ready");
    expect(edge(graph.edges, "room", "slides").kind).toBe("blocking");
    expect(byId(graph.nodes, "slides").kind).toBe("blocked");
    expect(byId(graph.nodes, "slides").waitingOn.map((ref) => ref.title)).toEqual([
      "Book the room",
    ]);
  });

  it("flags eligible nodes that exceed remaining budget", () => {
    let plan = unwrap(setDailyBudget(empty(clock), 2, clock));
    plan = add(plan, clock, { id: "talk", title: "Rewrite the guest talk", cost: 6 });
    const view = inspect(plan, clock);
    const graph = projectGraph(view);

    expect(byId(graph.nodes, "talk").kind).toBe("eligible");
    expect(byId(graph.nodes, "talk").exceedsBudget).toBe(true);
    expect(byId(graph.nodes, "talk").caption).toBe("Exceeds remaining budget");
    expect(byId(graph.nodes, "talk").captionTone).toBe("budget");
  });

  it("keeps plan node order as originalIndex so layout can stay stable", () => {
    const view = inspect(demoPlan(), clock);
    const graph = projectGraph(view);
    expect(graph.nodes.map((node) => node.id)).toEqual(
      view.plan.nodes.map((node) => node.id),
    );
    graph.nodes.forEach((node, index) => {
      expect(node.originalIndex).toBe(index);
    });
  });

  it("projects one directed edge per hard prerequisite", () => {
    const view = inspect(demoPlan(), clock);
    const graph = projectGraph(view);
    const expected = view.plan.nodes.flatMap((node) =>
      node.prerequisiteIds.map((from) => `${from}->${node.id}`),
    );
    expect(graph.edges.map((edge) => `${edge.from}->${edge.to}`).sort()).toEqual(
      [...expected].sort(),
    );
  });
});

function empty(clock: Clock): Plan {
  return {
    version: 1,
    title: "Test",
    dailyBudget: 8,
    activeDate: clock.today(),
    spentToday: 0,
    nodes: [],
  };
}

function add(
  plan: Plan,
  clock: Clock,
  input: { id: string; title: string; cost: number; prerequisiteIds?: string[] },
): Plan {
  const created = unwrap(
    createNode(
      plan,
      {
        title: input.title,
        cost: input.cost,
        prerequisiteIds: input.prerequisiteIds,
      },
      clock,
      () => input.id,
    ),
  );
  return created;
}

function chain(clock: Clock): Plan {
  let plan = empty(clock);
  plan = add(plan, clock, { id: "draft", title: "Draft", cost: 3 });
  plan = add(plan, clock, {
    id: "review",
    title: "Walk-through",
    cost: 2,
    prerequisiteIds: ["draft"],
  });
  plan = add(plan, clock, {
    id: "send",
    title: "Send",
    cost: 1,
    prerequisiteIds: ["review"],
  });
  return plan;
}

function diamond(clock: Clock): Plan {
  let plan = empty(clock);
  plan = add(plan, clock, { id: "outline", title: "Outline", cost: 2 });
  plan = add(plan, clock, { id: "room", title: "Book the room", cost: 1 });
  plan = add(plan, clock, {
    id: "slides",
    title: "Draft slides",
    cost: 5,
    prerequisiteIds: ["outline", "room"],
  });
  return plan;
}

function byTitle(plan: Plan, title: string) {
  const node = plan.nodes.find((item) => item.title === title);
  if (!node) throw new Error(`No node titled ${title}`);
  return node;
}

function byId<T extends { id: string }>(nodes: T[], id: string): T {
  const node = nodes.find((item) => item.id === id);
  if (!node) throw new Error(`No node ${id}`);
  return node;
}

function edge<T extends { from: string; to: string }>(
  edges: T[],
  from: string,
  to: string,
): T {
  const found = edges.find((item) => item.from === from && item.to === to);
  if (!found) throw new Error(`No edge ${from}->${to}`);
  return found;
}

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}
