import { describe, expect, it } from "vitest";
import { demoPlan } from "../demo/seed";
import { frozenClock } from "../domain/clock";
import { completeNode, explainChoice, inspect } from "../domain/plan";
import type { ChoiceExplanation, Plan } from "../domain/types";
import { graphSelectionFor } from "./selection";

const clock = frozenClock("2026-08-27");

describe("graphSelectionFor", () => {
  it("includes immediate unlocks for an eligible pending spend", () => {
    const explanation = explain(demoPlan(), "grocery");

    expect(graphSelectionFor("grocery", explanation)).toEqual({
      selectedId: "grocery",
      immediateUnlockIds: ["cook"],
    });
  });

  it("omits immediate unlocks for a completed selection", () => {
    const completed = must(completeNode(demoPlan(), "grocery", clock));
    const explanation = explain(completed, "grocery");

    expect(graphSelectionFor("grocery", explanation)).toEqual({
      selectedId: "grocery",
      immediateUnlockIds: [],
    });
  });
});

function explain(plan: Plan, nodeId: string): ChoiceExplanation {
  const result = explainChoice(inspect(plan, clock).plan, nodeId, clock);
  return must(result);
}

function must<T>(result: { ok: true; value: T } | { ok: false; error: { message: string } }): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}
