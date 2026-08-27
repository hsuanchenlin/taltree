import { describe, expect, it } from "vitest";
import { demoPlan } from "../demo/seed";
import { frozenClock } from "../domain/clock";
import {
  completeNode,
  createNode,
  explainChoice,
  inspect,
} from "../domain/plan";
import type { Clock, Plan, Result } from "../domain/types";
import { buildTalentTree } from "./build";
import { layoutGraph, nodeBoxesOverlap } from "./layout";
import { projectGraph } from "./project";
import { TREE_LAYOUT } from "./types";

const TODAY = "2026-08-27";
const clock = frozenClock(TODAY);

describe("talent-tree layout", () => {
  it("places a prerequisite above its dependent", () => {
    const tree = treeFrom(chain(clock));
    const draft = byId(tree.nodes, "draft");
    const review = byId(tree.nodes, "review");
    const send = byId(tree.nodes, "send");
    expect(draft.y).toBeLessThan(review.y);
    expect(review.y).toBeLessThan(send.y);
    expect(edge(tree.edges, "draft", "review").y1).toBe(draft.y + draft.height);
    expect(edge(tree.edges, "draft", "review").y2).toBe(review.y);
  });

  it("keeps independent trees in separate components packed left to right", () => {
    const tree = treeFrom(twoRoots(clock));
    const walk = byId(tree.nodes, "walk");
    const bill = byId(tree.nodes, "bill");
    expect(walk.y).toBe(bill.y);
    expect(bill.x).toBeGreaterThan(walk.x + walk.width);
  });

  it("centers a dependent under its two parents in a diamond", () => {
    const tree = treeFrom(diamond(clock));
    const outline = byId(tree.nodes, "outline");
    const room = byId(tree.nodes, "room");
    const slides = byId(tree.nodes, "slides");
    const parentMid = (centerX(outline) + centerX(room)) / 2;
    expect(Math.abs(centerX(slides) - parentMid)).toBeLessThanOrEqual(1);
    expect(slides.y).toBeGreaterThan(outline.y);
  });

  it("does not overlap node boxes on the demo plan", () => {
    const tree = buildTalentTree(inspect(demoPlan(), clock));
    expect(tree.nodes.length).toBe(demoPlan().nodes.length);
    assertNoOverlap(tree.nodes);
    expect(tree.width).toBeGreaterThan(TREE_LAYOUT.nodeWidth);
    expect(tree.height).toBeGreaterThan(TREE_LAYOUT.nodeHeight);
  });

  it("wraps a dense forest so width stays near the laptop target", () => {
    const tree = treeFrom(forest(clock, 12));
    expect(tree.nodes).toHaveLength(12);
    assertNoOverlap(tree.nodes);
    expect(tree.width).toBeLessThanOrEqual(TREE_LAYOUT.targetRowWidth + TREE_LAYOUT.padding * 2 + TREE_LAYOUT.nodeWidth);
    expect(tree.height).toBeGreaterThan(TREE_LAYOUT.nodeHeight + TREE_LAYOUT.padding * 2);
  });

  it("is deterministic and ignores selection when placing nodes", () => {
    const plan = demoPlan();
    const view = inspect(plan, clock);
    const first = buildTalentTree(view, { selectedId: "draft", immediateUnlockIds: ["review"] });
    const second = buildTalentTree(view, { selectedId: "tax", immediateUnlockIds: [] });
    expect(positions(first)).toEqual(positions(second));
    expect(positions(first)).toEqual(
      positions(layoutGraph(projectGraph(view, { selectedId: null, immediateUnlockIds: [] }))),
    );
  });

  it("keeps positions stable when a node is completed", () => {
    const plan = chain(clock);
    const before = positions(treeFrom(plan));
    const completed = unwrap(completeNode(plan, "draft", clock));
    const after = positions(treeFrom(completed));
    expect(after).toEqual(before);
  });

  it("fits a single connected dense dag without overlapping", () => {
    const tree = treeFrom(denseDag(clock));
    expect(tree.nodes.length).toBe(20);
    assertNoOverlap(tree.nodes);
    const roots = tree.nodes.filter((node) => node.id.startsWith("root"));
    const mids = tree.nodes.filter((node) => node.id.startsWith("mid"));
    const leaves = tree.nodes.filter((node) => node.id.startsWith("leaf"));
    expect(Math.max(...roots.map((node) => node.y))).toBeLessThan(Math.min(...mids.map((node) => node.y)));
    expect(Math.max(...mids.map((node) => node.y))).toBeLessThan(Math.min(...leaves.map((node) => node.y)));
  });

  it("returns a compact empty board for a plan with no nodes", () => {
    const tree = buildTalentTree(inspect(empty(clock), clock));
    expect(tree.nodes).toEqual([]);
    expect(tree.edges).toEqual([]);
    expect(tree.width).toBe(TREE_LAYOUT.padding * 2);
    expect(tree.height).toBe(TREE_LAYOUT.padding * 2);
  });

  it("exposes unlock edges for the selected eligible node on the demo plan", () => {
    const view = inspect(demoPlan(), clock);
    const grocery = unwrap(explainChoice(view.plan, "grocery", clock));
    const draft = unwrap(explainChoice(view.plan, "draft", clock));
    const tree = buildTalentTree(view, {
      selectedId: "grocery",
      immediateUnlockIds: grocery.immediateUnlocks.map((ref) => ref.id),
    });
    expect(grocery.immediateUnlocks.map((ref) => ref.id)).toEqual(["cook"]);
    expect(draft.immediateUnlocks).toEqual([]);
    expect(byId(tree.nodes, "cook").unlocksIfCompleted).toBe(true);
    expect(edge(tree.edges, "grocery", "cook").kind).toBe("unlock");
    expect(edge(tree.edges, "grocery", "cook").d.startsWith("M ")).toBe(true);
    expect(edge(tree.edges, "draft", "review").kind).toBe("blocking");
  });
});

function treeFrom(plan: Plan) {
  return buildTalentTree(inspect(plan, clock));
}

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
  return unwrap(
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

function twoRoots(clock: Clock): Plan {
  let plan = empty(clock);
  plan = add(plan, clock, { id: "walk", title: "Walk", cost: 1 });
  plan = add(plan, clock, { id: "bill", title: "Pay the bill", cost: 1 });
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

function forest(clock: Clock, count: number): Plan {
  let plan = empty(clock);
  for (let index = 0; index < count; index += 1) {
    plan = add(plan, clock, {
      id: `solo-${index}`,
      title: `Solo ${index}`,
      cost: 1,
    });
  }
  return plan;
}

function denseDag(clock: Clock): Plan {
  let plan = empty(clock);
  for (let index = 0; index < 8; index += 1) {
    plan = add(plan, clock, { id: `root-${index}`, title: `Root ${index}`, cost: 1 });
  }
  for (let index = 0; index < 8; index += 1) {
    const left = `root-${index}`;
    const right = `root-${(index + 1) % 8}`;
    plan = add(plan, clock, {
      id: `mid-${index}`,
      title: `Mid ${index}`,
      cost: 1,
      prerequisiteIds: [left, right],
    });
  }
  for (let index = 0; index < 4; index += 1) {
    plan = add(plan, clock, {
      id: `leaf-${index}`,
      title: `Leaf ${index}`,
      cost: 1,
      prerequisiteIds: [`mid-${index * 2}`, `mid-${index * 2 + 1}`],
    });
  }
  return plan;
}

function positions(tree: { nodes: { id: string; x: number; y: number }[] }) {
  return Object.fromEntries(tree.nodes.map((node) => [node.id, { x: node.x, y: node.y }]));
}

function centerX(node: { x: number; width: number }) {
  return node.x + node.width / 2;
}

function assertNoOverlap(nodes: Parameters<typeof nodeBoxesOverlap>[0][]) {
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const a = nodes[i];
      const b = nodes[j];
      if (!a || !b) continue;
      expect(nodeBoxesOverlap(a, b), `${a.id} overlaps ${b.id}`).toBe(false);
    }
  }
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
