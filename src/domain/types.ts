export type NodeStatus = "open" | "completed";

export interface PlanNode {
  id: string;
  title: string;
  /**
   * Optional label putting this node in a named section of the list.
   *
   * Grouping is presentation, never scheduling: a group has no bearing on
   * eligibility, budget, or what unlocks what.
   */
  group: string | null;
  cost: number;
  status: NodeStatus;
  deferredOn: string | null;
  completedOn: string | null;
  prerequisiteIds: string[];
  /** Free-text annotation. Typed resource links live here, not in a separate field. */
  notes: string | null;
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
  notes?: string | null;
  /** The group a new node joins; a blank label means none. */
  group?: string | null;
}

export interface NodePatch {
  title?: string;
  cost?: number;
  prerequisiteIds?: string[];
  /** `undefined` leaves notes alone; `null` or blank clears them. */
  notes?: string | null;
  /** `undefined` leaves the group alone; `null` or blank clears it. */
  group?: string | null;
}
