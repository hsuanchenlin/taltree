import type { NodeKind, NodeListing } from "../domain/types";
import { pointsLabel } from "./format";
import { KindMark } from "./glyphs";

const GROUPS: { kind: NodeKind; title: string; hint: string }[] = [
  {
    kind: "eligible",
    title: "Frontier",
    hint: "Eligible now. Completing one spends today's budget and may unlock what waits on it.",
  },
  {
    kind: "deferred",
    title: "Deferred today",
    hint: "Still incomplete. They return to the frontier tomorrow, or you can undefer them now.",
  },
  {
    kind: "blocked",
    title: "Blocked",
    hint: "Waiting on a hard prerequisite. The direct reason is named on each row.",
  },
  {
    kind: "completed",
    title: "Completed",
    hint: "Done. Unused budget still expires at midnight; this work does not need to be redone.",
  },
];

interface NodeListProps {
  listings: NodeListing[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function NodeList({ listings, selectedId, onSelect }: NodeListProps) {
  return (
    <div className="lists">
      {GROUPS.map((group) => {
        const items = listings.filter((item) => item.kind === group.kind);
        return (
          <section key={group.kind} className="group" aria-labelledby={`group-${group.kind}`}>
            <header className="group-head">
              <h2 id={`group-${group.kind}`}>
                {group.title}{" "}
                <span className="count">{items.length}</span>
              </h2>
              <p>{group.hint}</p>
            </header>
            {items.length === 0 ? (
              <p className="empty-group">None.</p>
            ) : (
              <ul className="node-rows" role="listbox" aria-labelledby={`group-${group.kind}`}>
                {items.map((item) => {
                  const selected = item.node.id === selectedId;
                  const reason =
                    item.kind === "blocked" && item.waitingOn[0]
                      ? `Waiting on ${item.waitingOn.map((ref) => ref.title).join(", ")}`
                      : item.exceedsBudget
                        ? "Exceeds remaining budget"
                        : null;
                  return (
                    <li key={item.node.id}>
                      <button
                        type="button"
                        role="option"
                        id={`node-${item.node.id}`}
                        className={`node-row${selected ? " selected" : ""}`}
                        aria-selected={selected}
                        onClick={() => onSelect(item.node.id)}
                      >
                        <span className="node-main">
                          <span className="node-title">{item.node.title}</span>
                          <KindMark kind={item.kind} />
                          {reason ? <span className="node-reason">{reason}</span> : null}
                        </span>
                        <span className="node-cost">{pointsLabel(item.node.cost)}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
