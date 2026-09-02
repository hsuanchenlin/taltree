import { describe, expect, it } from "vitest";
import { frozenClock } from "./clock";
import {
  completeNode,
  createNode,
  cycleIfAdded,
  deferNode,
  editNode,
  emptyPlan,
  explainChoice,
  inspect,
  remainingBudget,
  setDailyBudget,
  syncDay,
  undeferNode,
} from "./plan";
import type { Clock, NodeInput, Plan, PlanError, Result } from "./types";

const TODAY = "2026-08-27";
const TOMORROW = "2026-08-28";
const today = frozenClock(TODAY);
const tomorrow = frozenClock(TOMORROW);

describe("eligibility", () => {
  it("places a node with no prerequisites on the frontier", () => {
    const plan = add(emptyPlan(today), today, { title: "Triage inbox", cost: 1 });
    expect(frontierTitles(plan, today)).toEqual(["Triage inbox"]);
  });

  it("keeps a node off the frontier while a hard prerequisite is open", () => {
    const plan = proposalChain(today);
    expect(frontierTitles(plan, today)).toEqual(["Draft the proposal"]);
    expect(kindOf(plan, today, "Send the proposal")).toBe("blocked");
  });

  it("moves a node onto the frontier once every hard prerequisite is completed", () => {
    let plan = proposalChain(today);
    plan = complete(plan, today, "Draft the proposal");
    expect(frontierTitles(plan, today)).toEqual(["Walk through with a teammate"]);
    plan = complete(plan, today, "Walk through with a teammate");
    expect(frontierTitles(plan, today)).toContain("Send the proposal");
    expect(kindOf(plan, today, "Send the proposal")).toBe("eligible");
  });

  it("excludes completed nodes from the frontier", () => {
    let plan = add(emptyPlan(today), today, { title: "Call the dentist", cost: 1 });
    plan = complete(plan, today, "Call the dentist");
    expect(frontierTitles(plan, today)).toEqual([]);
    expect(kindOf(plan, today, "Call the dentist")).toBe("completed");
  });

  it("excludes nodes deferred today from the frontier", () => {
    let plan = add(emptyPlan(today), today, { title: "Grocery run", cost: 2 });
    plan = unwrap(deferNode(plan, byTitle(plan, "Grocery run").id, today));
    expect(frontierTitles(plan, today)).toEqual([]);
    expect(kindOf(plan, today, "Grocery run")).toBe("deferred");
  });
});

describe("cycle rejection", () => {
  it("rejects a self-prerequisite and names the node", () => {
    const plan = add(emptyPlan(today), today, { title: "Rewrite the talk", cost: 6 });
    const id = byTitle(plan, "Rewrite the talk").id;
    const cycle = cycleIfAdded(plan, id, id);
    expect(cycle?.code).toBe("cycle");
    expect(cycle?.message).toContain("cannot be a prerequisite of itself");
    expect(cycle?.message).toContain("Rewrite the talk");

    const result = editNode(plan, id, { prerequisiteIds: [id] }, today);
    expectError(result, "cycle");
  });

  it("rejects a two-node cycle and describes the loop", () => {
    let plan = emptyPlan(today);
    plan = add(plan, today, { title: "Outline", cost: 2 });
    plan = add(plan, today, { title: "Draft", cost: 3 });
    const outline = byTitle(plan, "Outline").id;
    const draft = byTitle(plan, "Draft").id;
    plan = unwrap(editNode(plan, draft, { prerequisiteIds: [outline] }, today));

    const result = editNode(plan, outline, { prerequisiteIds: [draft] }, today);
    const error = expectError(result, "cycle");
    expect(error.message).toContain("Outline");
    expect(error.message).toContain("Draft");
    expect(error.message).toContain("→");
    expect(error.path).toEqual([draft, outline, draft]);
  });

  it("rejects a longer cycle and lists the loop in order", () => {
    let plan = emptyPlan(today);
    plan = add(plan, today, { title: "Read", cost: 2 });
    plan = add(plan, today, { title: "Outline", cost: 3 });
    plan = add(plan, today, { title: "Slides", cost: 5 });
    const read = byTitle(plan, "Read").id;
    const outline = byTitle(plan, "Outline").id;
    const slides = byTitle(plan, "Slides").id;
    plan = unwrap(editNode(plan, outline, { prerequisiteIds: [read] }, today));
    plan = unwrap(editNode(plan, slides, { prerequisiteIds: [outline] }, today));

    const result = editNode(plan, read, { prerequisiteIds: [slides] }, today);
    const error = expectError(result, "cycle");
    expect(error.path).toEqual([slides, read, outline, slides]);
    expect(error.message).toMatch(/Read.*Outline.*Slides|Slides.*Read.*Outline/);
  });

  it("accepts a valid chain of hard prerequisites", () => {
    const plan = proposalChain(today);
    expect(plan.nodes).toHaveLength(3);
    expect(byTitle(plan, "Send the proposal").prerequisiteIds).toEqual([
      byTitle(plan, "Walk through with a teammate").id,
    ]);
  });
});

describe("budget", () => {
  it("starts the day with the full daily budget remaining", () => {
    const plan = unwrap(setDailyBudget(emptyPlan(today), 8, today));
    expect(remainingBudget(inspect(plan, today).plan)).toBe(8);
    expect(inspect(plan, today).remaining).toBe(8);
  });

  it("reduces remaining budget by the completed node's cost", () => {
    let plan = unwrap(setDailyBudget(emptyPlan(today), 8, today));
    plan = add(plan, today, { title: "Triage inbox", cost: 1 });
    plan = add(plan, today, { title: "Draft the proposal", cost: 3 });
    plan = complete(plan, today, "Triage inbox");
    expect(inspect(plan, today).remaining).toBe(7);
    plan = complete(plan, today, "Draft the proposal");
    expect(inspect(plan, today).remaining).toBe(4);
    expect(plan.spentToday).toBe(4);
  });

  it("never reports remaining below zero after overspend", () => {
    let plan = unwrap(setDailyBudget(emptyPlan(today), 2, today));
    plan = add(plan, today, { title: "Finish the tax packet", cost: 5 });
    plan = complete(plan, today, "Finish the tax packet");
    expect(plan.spentToday).toBe(5);
    expect(inspect(plan, today).remaining).toBe(0);
  });

  it("expires unused budget when the calendar day changes", () => {
    let plan = unwrap(setDailyBudget(emptyPlan(today), 8, today));
    plan = add(plan, today, { title: "Thirty-minute walk", cost: 1 });
    plan = complete(plan, today, "Thirty-minute walk");
    expect(inspect(plan, today).remaining).toBe(7);

    const rolled = inspect(plan, tomorrow);
    expect(rolled.plan.activeDate).toBe(TOMORROW);
    expect(rolled.plan.spentToday).toBe(0);
    expect(rolled.remaining).toBe(8);
  });

  it("marks an eligible node that does not fit remaining budget", () => {
    let plan = unwrap(setDailyBudget(emptyPlan(today), 2, today));
    plan = add(plan, today, { title: "Rewrite the talk", cost: 6 });
    const listing = inspect(plan, today).frontier[0];
    expect(listing?.node.title).toBe("Rewrite the talk");
    expect(listing?.exceedsBudget).toBe(true);
  });
});

describe("unlock and block explanations", () => {
  it("reports cost and whether the candidate fits remaining budget", () => {
    let plan = unwrap(setDailyBudget(emptyPlan(today), 8, today));
    plan = add(plan, today, { title: "Draft the proposal", cost: 3 });
    const explanation = unwrap(
      explainChoice(plan, byTitle(plan, "Draft the proposal").id, today),
    );
    expect(explanation.cost).toBe(3);
    expect(explanation.remainingBudget).toBe(8);
    expect(explanation.fitsBudget).toBe(true);
    expect(explanation.overBy).toBe(0);
    expect(explanation.eligible).toBe(true);
  });

  it("lists dependents that would unlock immediately", () => {
    const plan = talkPrep(today);
    const explanation = unwrap(
      explainChoice(plan, byTitle(plan, "Write the outline").id, today),
    );
    expect(explanation.immediateUnlocks.map((ref) => ref.title)).toEqual([
      "Prepare the handout",
    ]);
  });

  it("lists dependents still blocked and their remaining direct prerequisites", () => {
    const plan = talkPrep(today);
    const explanation = unwrap(
      explainChoice(plan, byTitle(plan, "Write the outline").id, today),
    );
    expect(explanation.stillBlockedDependents).toEqual([
      {
        id: byTitle(plan, "Draft slides").id,
        title: "Draft slides",
        waitingOn: [
          {
            id: byTitle(plan, "Book the projector").id,
            title: "Book the projector",
          },
        ],
      },
    ]);
  });

  it("names the direct reason a blocked node is waiting", () => {
    const plan = proposalChain(today);
    const listing = inspect(plan, today).listings.find(
      (item) => item.node.title === "Send the proposal",
    );
    expect(listing?.kind).toBe("blocked");
    expect(listing?.waitingOn.map((ref) => ref.title)).toEqual([
      "Walk through with a teammate",
    ]);
  });
});

describe("completion", () => {
  it("marks the node completed and spends its cost", () => {
    let plan = add(emptyPlan(today), today, { title: "Pay the bill", cost: 1 });
    plan = complete(plan, today, "Pay the bill");
    const node = byTitle(plan, "Pay the bill");
    expect(node.status).toBe("completed");
    expect(node.completedOn).toBe(TODAY);
    expect(plan.spentToday).toBe(1);
  });

  it("refuses to complete a blocked node and names the blocker", () => {
    const plan = proposalChain(today);
    const result = completeNode(
      plan,
      byTitle(plan, "Send the proposal").id,
      today,
    );
    const error = expectError(result, "blocked");
    expect(error.message).toContain("Send the proposal");
    expect(error.message).toContain("Walk through with a teammate");
    expect(error.waitingOn?.map((ref) => ref.title)).toEqual([
      "Walk through with a teammate",
    ]);
    expect(byTitle(plan, "Send the proposal").status).toBe("open");
  });

  it("updates remaining budget and the frontier after completion", () => {
    let plan = unwrap(setDailyBudget(emptyPlan(today), 8, today));
    plan = proposalChain(today, plan);
    expect(frontierTitles(plan, today)).toEqual(["Draft the proposal"]);
    plan = complete(plan, today, "Draft the proposal");
    const view = inspect(plan, today);
    expect(view.remaining).toBe(5);
    expect(view.frontier.map((item) => item.node.title)).toEqual([
      "Walk through with a teammate",
    ]);
  });
});

describe("defer", () => {
  it("removes an eligible node from today's frontier without completing it", () => {
    let plan = add(emptyPlan(today), today, { title: "Grocery run", cost: 2 });
    plan = unwrap(deferNode(plan, byTitle(plan, "Grocery run").id, today));
    const node = byTitle(plan, "Grocery run");
    expect(node.status).toBe("open");
    expect(node.deferredOn).toBe(TODAY);
    expect(frontierTitles(plan, today)).toEqual([]);
    expect(plan.spentToday).toBe(0);
  });

  it("returns a deferred node to the frontier when undeferred the same day", () => {
    let plan = add(emptyPlan(today), today, { title: "Pack the bag", cost: 1 });
    const id = byTitle(plan, "Pack the bag").id;
    plan = unwrap(deferNode(plan, id, today));
    plan = unwrap(undeferNode(plan, id, today));
    expect(frontierTitles(plan, today)).toEqual(["Pack the bag"]);
  });
});

describe("notes", () => {
  it("starts a new node with empty notes", () => {
    const plan = add(emptyPlan(today), today, { title: "Triage inbox", cost: 1 });
    expect(byTitle(plan, "Triage inbox").notes).toBeNull();
  });

  it("stores notes and keeps them through complete and an unrelated edit", () => {
    let plan = add(emptyPlan(today), today, {
      title: "Find receipts",
      cost: 2,
      notes:
        "Shoebox in the hall.\n- [@article@The Internet](https://en.wikipedia.org/wiki/Internet)",
    });
    const id = byTitle(plan, "Find receipts").id;
    expect(byTitle(plan, "Find receipts").notes).toContain("The Internet");

    plan = unwrap(editNode(plan, id, { title: "Find last year's receipts" }, today));
    expect(byTitle(plan, "Find last year's receipts").notes).toContain(
      "The Internet",
    );

    plan = complete(plan, today, "Find last year's receipts");
    expect(byTitle(plan, "Find last year's receipts").notes).toContain(
      "The Internet",
    );
  });

  it("clears notes when patched with a blank string", () => {
    let plan = add(emptyPlan(today), today, {
      title: "Take a walk",
      cost: 1,
      notes: "Around the block",
    });
    const id = byTitle(plan, "Take a walk").id;
    plan = unwrap(editNode(plan, id, { notes: "   " }, today));
    expect(byTitle(plan, "Take a walk").notes).toBeNull();
  });
});

describe("rollover", () => {
  it("keeps unfinished work after a missed day", () => {
    let plan = proposalChain(today);
    plan = complete(plan, today, "Draft the proposal");
    const rolled = inspect(plan, tomorrow).plan;
    expect(byTitle(rolled, "Draft the proposal").status).toBe("completed");
    expect(byTitle(rolled, "Walk through with a teammate").status).toBe("open");
    expect(byTitle(rolled, "Send the proposal").status).toBe("open");
  });

  it("returns yesterday's deferred work to the frontier", () => {
    let plan = add(emptyPlan(today), today, { title: "Call the dentist", cost: 1 });
    plan = unwrap(deferNode(plan, byTitle(plan, "Call the dentist").id, today));
    expect(kindOf(plan, today, "Call the dentist")).toBe("deferred");
    expect(kindOf(plan, tomorrow, "Call the dentist")).toBe("eligible");
    expect(frontierTitles(plan, tomorrow)).toEqual(["Call the dentist"]);
  });

  it("does not carry unused budget into the next day", () => {
    let plan = unwrap(setDailyBudget(emptyPlan(today), 8, today));
    plan = add(plan, today, { title: "Read the school email", cost: 1 });
    plan = complete(plan, today, "Read the school email");
    expect(inspect(plan, today).remaining).toBe(7);
    const rolled = syncDay(plan, tomorrow);
    expect(rolled.spentToday).toBe(0);
    expect(remainingBudget(rolled)).toBe(8);
  });

  it("does not punish a missed day with a smaller budget or a streak", () => {
    const plan = unwrap(setDailyBudget(emptyPlan(today), 8, today));
    const rolled = inspect(plan, tomorrow);
    expect(rolled.plan.dailyBudget).toBe(8);
    expect(rolled.remaining).toBe(8);
    expect(rolled.plan.spentToday).toBe(0);
  });
});

function add(plan: Plan, clock: Clock, input: NodeInput): Plan {
  return unwrap(createNode(plan, input, clock));
}

function complete(plan: Plan, clock: Clock, title: string): Plan {
  return unwrap(completeNode(plan, byTitle(plan, title).id, clock));
}

function proposalChain(clock: Clock, start?: Plan): Plan {
  let plan = start ?? emptyPlan(clock);
  plan = add(plan, clock, { title: "Draft the proposal", cost: 3 });
  plan = add(plan, clock, {
    title: "Walk through with a teammate",
    cost: 2,
    prerequisiteIds: [byTitle(plan, "Draft the proposal").id],
  });
  plan = add(plan, clock, {
    title: "Send the proposal",
    cost: 1,
    prerequisiteIds: [byTitle(plan, "Walk through with a teammate").id],
  });
  return plan;
}

function talkPrep(clock: Clock): Plan {
  let plan = emptyPlan(clock);
  plan = add(plan, clock, { title: "Write the outline", cost: 3 });
  plan = add(plan, clock, { title: "Book the projector", cost: 1 });
  const outline = byTitle(plan, "Write the outline").id;
  const projector = byTitle(plan, "Book the projector").id;
  plan = add(plan, clock, {
    title: "Draft slides",
    cost: 5,
    prerequisiteIds: [outline, projector],
  });
  plan = add(plan, clock, {
    title: "Prepare the handout",
    cost: 2,
    prerequisiteIds: [outline],
  });
  plan = add(plan, clock, {
    title: "Rehearse",
    cost: 2,
    prerequisiteIds: [byTitle(plan, "Draft slides").id],
  });
  return plan;
}

function frontierTitles(plan: Plan, clock: Clock): string[] {
  return inspect(plan, clock).frontier.map((item) => item.node.title);
}

function kindOf(plan: Plan, clock: Clock, title: string) {
  const listing = inspect(plan, clock).listings.find(
    (item) => item.node.title === title,
  );
  if (!listing) throw new Error(`No listing for ${title}`);
  return listing.kind;
}

function byTitle(plan: Plan, title: string) {
  const node = plan.nodes.find((item) => item.title === title);
  if (!node) throw new Error(`No node titled ${title}`);
  return node;
}

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

function expectError(result: Result<unknown>, code: PlanError["code"]): PlanError {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected failure");
  expect(result.error.code).toBe(code);
  return result.error;
}
