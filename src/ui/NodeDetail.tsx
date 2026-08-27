import type { ChoiceExplanation, NodeListing } from "../domain/types";
import { pointsLabel } from "./format";
import { KindMark } from "./glyphs";

interface NodeDetailProps {
  listing: NodeListing | null;
  explanation: ChoiceExplanation | null;
  onComplete: () => void;
  onDefer: () => void;
  onUndefer: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onClose: () => void;
  mobileOpen: boolean;
  backLabel?: string;
}

export function NodeDetail({
  listing,
  explanation,
  onComplete,
  onDefer,
  onUndefer,
  onEdit,
  onDelete,
  onClose,
  mobileOpen,
  backLabel = "Back to list",
}: NodeDetailProps) {
  const paneClass = `detail${mobileOpen ? " mobile-open" : ""}`;
  if (!listing || !explanation) {
    return (
      <aside className={paneClass} aria-label="Node detail">
        <div className="detail-empty">
          <h2>Select a node</h2>
          <p>
            The talent tree is the plan. Select a node to see its cost, whether it
            fits remaining budget, what completing it would unlock immediately, and
            which dependents stay blocked with their direct reason. The list view
            is the same plan, grouped for keyboard browsing.
          </p>
        </div>
      </aside>
    );
  }

  const { node, kind } = listing;
  const canComplete = explanation.eligible;
  const canDefer = node.status === "open" && kind !== "deferred";
  const canUndefer = kind === "deferred";

  return (
    <aside className={paneClass} aria-label="Node detail">
      <button type="button" className="text-btn close-detail" onClick={onClose}>
        {backLabel}
      </button>
      <header className="detail-head">
        <h2>{node.title}</h2>
        <p className="detail-meta">
          <KindMark kind={kind} />
          <span>{pointsLabel(node.cost)}</span>
        </p>
      </header>

      <section>
        <h3>This choice</h3>
        <dl className="facts">
          <div>
            <dt>Cost</dt>
            <dd>{pointsLabel(explanation.cost)}</dd>
          </div>
          <div>
            <dt>Remaining budget</dt>
            <dd>{pointsLabel(explanation.remainingBudget)}</dd>
          </div>
          <div>
            <dt>Fit</dt>
            <dd>
              {explanation.completed
                ? "Already completed"
                : explanation.fitsBudget
                  ? "Fits remaining budget"
                  : `Exceeds remaining budget by ${pointsLabel(explanation.overBy)}`}
            </dd>
          </div>
        </dl>
      </section>

      {explanation.waitingOn.length > 0 ? (
        <section>
          <h3>Direct reason it is blocked</h3>
          <ul>
            {explanation.waitingOn.map((ref) => (
              <li key={ref.id}>{ref.title}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <section>
        <h3>Immediately unlocks</h3>
        {explanation.immediateUnlocks.length === 0 ? (
          <p className="quiet">Nothing new becomes eligible if this is completed now.</p>
        ) : (
          <ul>
            {explanation.immediateUnlocks.map((ref) => (
              <li key={ref.id}>{ref.title}</li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3>Still blocked after this</h3>
        {explanation.stillBlockedDependents.length === 0 ? (
          <p className="quiet">No dependents would remain blocked by other unfinished prerequisites.</p>
        ) : (
          <ul>
            {explanation.stillBlockedDependents.map((item) => (
              <li key={item.id}>
                {item.title}
                <span className="node-reason">
                  Waiting on {item.waitingOn.map((ref) => ref.title).join(", ")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {node.prerequisiteIds.length > 0 && explanation.waitingOn.length === 0 ? (
        <p className="quiet">All hard prerequisites for this node are completed.</p>
      ) : null}

      <div className="detail-actions">
        <button type="button" className="primary" onClick={onComplete} disabled={!canComplete}>
          Complete
        </button>
        {canUndefer ? (
          <button type="button" onClick={onUndefer}>
            Return to frontier
          </button>
        ) : (
          <button type="button" onClick={onDefer} disabled={!canDefer}>
            Defer today
          </button>
        )}
        <button type="button" onClick={onEdit}>
          Edit
        </button>
        <button type="button" className="danger" onClick={onDelete}>
          Delete
        </button>
      </div>
    </aside>
  );
}
