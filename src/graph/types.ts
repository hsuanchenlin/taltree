import type { NamedRef, NodeKind } from "../domain/types";

export type EdgeKind = "unlock" | "blocking" | "ready";
export type CaptionTone = "blocked" | "unlock" | "budget";
export type NavDirection = "up" | "down" | "left" | "right";

export interface GraphSelection {
  selectedId: string | null;
  immediateUnlockIds: readonly string[];
}

export interface GraphNode {
  id: string;
  title: string;
  cost: number;
  kind: NodeKind;
  originalIndex: number;
  exceedsBudget: boolean;
  waitingOn: NamedRef[];
  selected: boolean;
  unlocksIfCompleted: boolean;
  caption: string | null;
  captionTone: CaptionTone | null;
}

export interface GraphEdge {
  from: string;
  to: string;
  kind: EdgeKind;
}

export interface GraphModel {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface LaidOutNode extends GraphNode {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LaidOutEdge extends GraphEdge {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  d: string;
}

export interface LaidOutGraph {
  nodes: LaidOutNode[];
  edges: LaidOutEdge[];
  width: number;
  height: number;
}

export const TREE_LAYOUT = {
  nodeWidth: 200,
  nodeHeight: 108,
  columnGap: 32,
  rankGap: 76,
  componentGap: 40,
  rowGap: 56,
  padding: 32,
  targetRowWidth: 760,
} as const;
