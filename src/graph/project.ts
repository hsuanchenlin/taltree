import type { NodeListing, PlanView } from "../domain/types";
import type {
  CaptionTone,
  EdgeKind,
  GraphEdge,
  GraphModel,
  GraphNode,
  GraphSelection,
} from "./types";

export function projectGraph(
  view: PlanView,
  selection: GraphSelection = { selectedId: null, immediateUnlockIds: [] },
): GraphModel {
  const listingById = new Map(
    view.listings.map((listing) => [listing.node.id, listing]),
  );
  const unlocks = new Set(selection.immediateUnlockIds);
  const nodes: GraphNode[] = [];

  view.plan.nodes.forEach((node, originalIndex) => {
    const listing = listingById.get(node.id);
    if (!listing) return;
    const selected = node.id === selection.selectedId;
    const unlocksIfCompleted = unlocks.has(node.id);
    const caption = captionFor(listing, unlocksIfCompleted);
    nodes.push({
      id: node.id,
      title: node.title,
      cost: node.cost,
      kind: listing.kind,
      originalIndex,
      exceedsBudget: listing.exceedsBudget,
      waitingOn: listing.waitingOn,
      selected,
      unlocksIfCompleted,
      caption: caption?.text ?? null,
      captionTone: caption?.tone ?? null,
    });
  });

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const edges: GraphEdge[] = [];
  for (const node of view.plan.nodes) {
    for (const prereqId of node.prerequisiteIds) {
      if (!nodeById.has(prereqId) || !nodeById.has(node.id)) continue;
      edges.push({
        from: prereqId,
        to: node.id,
        kind: edgeKind(prereqId, node.id, nodeById, unlocks, selection.selectedId),
      });
    }
  }

  return { nodes, edges };
}

function captionFor(
  listing: NodeListing,
  unlocksIfCompleted: boolean,
): { text: string; tone: CaptionTone } | null {
  if (unlocksIfCompleted) {
    return { text: "Unlocks next", tone: "unlock" };
  }
  if (listing.kind === "blocked" && listing.waitingOn.length > 0) {
    return {
      text: `Waiting on ${listing.waitingOn.map((ref) => ref.title).join(", ")}`,
      tone: "blocked",
    };
  }
  if (listing.exceedsBudget) {
    return { text: "Exceeds remaining budget", tone: "budget" };
  }
  return null;
}

function edgeKind(
  fromId: string,
  toId: string,
  nodeById: Map<string, GraphNode>,
  unlocks: Set<string>,
  selectedId: string | null,
): EdgeKind {
  if (fromId === selectedId && unlocks.has(toId)) return "unlock";
  const from = nodeById.get(fromId);
  if (from?.kind === "completed") return "ready";
  return "blocking";
}
