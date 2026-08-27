export type NodeStatus = "open" | "completed";

export interface PlanNode {
  id: string;
  title: string;
  cost: number;
  status: NodeStatus;
  deferredOn: string | null;
  completedOn: string | null;
  prerequisiteIds: string[];
}

export interface Plan {
  version: 1;
  title: string;
  dailyBudget: number;
  activeDate: string;
  spentToday: number;
  nodes: PlanNode[];
}

export interface Clock {
  today(): string;
}

export type PlanErrorCode = "not-found" | "cycle" | "blocked" | "invalid";

export interface PlanError {
  code: PlanErrorCode;
  message: string;
  nodeId?: string;
  path?: string[];
  waitingOn?: NamedRef[];
}

export interface NamedRef {
  id: string;
  title: string;
}

export type Result<T, E = PlanError> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export interface ChoiceExplanation {
  node: PlanNode;
  cost: number;
  remainingBudget: number;
  fitsBudget: boolean;
  overBy: number;
  immediateUnlocks: NamedRef[];
  stillBlockedDependents: BlockedDependent[];
  waitingOn: NamedRef[];
  eligible: boolean;
  deferredToday: boolean;
  completed: boolean;
}

export interface BlockedDependent {
  id: string;
  title: string;
  waitingOn: NamedRef[];
}

export type NodeKind = "eligible" | "deferred" | "blocked" | "completed";

export interface NodeListing {
  node: PlanNode;
  kind: NodeKind;
  waitingOn: NamedRef[];
  exceedsBudget: boolean;
}

export interface PlanView {
  plan: Plan;
  remaining: number;
  listings: NodeListing[];
  frontier: NodeListing[];
}

export interface NodeInput {
  title: string;
  cost: number;
  prerequisiteIds?: string[];
}

export interface NodePatch {
  title?: string;
  cost?: number;
  prerequisiteIds?: string[];
}
