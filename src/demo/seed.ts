import type { Plan } from "../domain/types";

/**
 * A useful Thursday for an overloaded person: more eligible work than
 * one day's budget, with a few chains so choices have unlock consequences.
 */
export function demoPlan(): Plan {
  return {
    version: 1,
    title: "A full Thursday",
    dailyBudget: 8,
    activeDate: "1970-01-01",
    spentToday: 0,
    nodes: [
      node("inbox", "Triage inbox", 1),
      node("bill", "Pay the overdue electricity bill", 1),
      node("receipts", "Find last year's receipts", 2),
      node("tax", "Finish the tax packet", 5, ["receipts"]),
      node("draft", "Draft the project proposal", 3),
      node("slot", "Block a 30-minute meeting slot", 1),
      node("review", "Walk through the proposal with a teammate", 2, ["draft", "slot"]),
      node("send", "Send the proposal", 1, ["review"]),
      node("grocery", "Grocery run", 2),
      node("cook", "Cook dinner", 2, ["grocery"]),
      node("walk", "Thirty-minute walk", 1),
      node("school", "Read the school email", 1),
      node("rsvp", "RSVP to the school event", 1, ["school"]),
      node("pack", "Pack tomorrow's bag", 1),
      node("dentist", "Call the dentist", 1),
      node("talk", "Rewrite the guest talk", 6),
    ],
  };
}

function node(
  id: string,
  title: string,
  cost: number,
  prerequisiteIds: string[] = [],
): Plan["nodes"][number] {
  return {
    id,
    title,
    cost,
    status: "open",
    deferredOn: null,
    completedOn: null,
    prerequisiteIds,
  };
}
