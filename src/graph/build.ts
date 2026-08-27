import type { PlanView } from "../domain/types";
import { layoutGraph } from "./layout";
import { projectGraph } from "./project";
import type { GraphSelection, LaidOutGraph } from "./types";

export function buildTalentTree(
  view: PlanView,
  selection: GraphSelection = { selectedId: null, immediateUnlockIds: [] },
): LaidOutGraph {
  return layoutGraph(projectGraph(view, selection));
}
