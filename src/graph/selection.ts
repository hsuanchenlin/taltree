import type { ChoiceExplanation } from "../domain/types";
import type { GraphSelection } from "./types";

export function graphSelectionFor(
  selectedId: string | null,
  explanation: ChoiceExplanation | null,
): GraphSelection {
  return {
    selectedId,
    immediateUnlockIds:
      explanation?.eligible && !explanation.completed
        ? explanation.immediateUnlocks.map((ref) => ref.id)
        : [],
  };
}
