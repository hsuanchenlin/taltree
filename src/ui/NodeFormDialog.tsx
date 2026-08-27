import { useEffect, useId, useRef, useState } from "react";
import { cycleIfAdded } from "../domain/plan";
import type { Plan, PlanNode } from "../domain/types";

interface NodeFormDialogProps {
  open: boolean;
  mode: "create" | "edit";
  plan: Plan;
  node: PlanNode | null;
  error: string | null;
  onClose: () => void;
  onSubmit: (input: {
    title: string;
    cost: number;
    prerequisiteIds: string[];
  }) => boolean;
}

export function NodeFormDialog({
  open,
  mode,
  plan,
  node,
  error,
  onClose,
  onSubmit,
}: NodeFormDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [title, setTitle] = useState("");
  const [cost, setCost] = useState(1);
  const [prerequisiteIds, setPrerequisiteIds] = useState<string[]>([]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setTitle(node?.title ?? "");
    setCost(node?.cost ?? 1);
    setPrerequisiteIds(node?.prerequisiteIds ?? []);
  }, [open, node]);

  const candidates = plan.nodes.filter((item) => item.id !== node?.id);

  return (
    <dialog
      ref={dialogRef}
      className="modal"
      aria-labelledby={titleId}
      onClose={onClose}
      onCancel={onClose}
    >
      <form
        method="dialog"
        onSubmit={(event) => {
          event.preventDefault();
          const saved = onSubmit({ title, cost, prerequisiteIds });
          if (saved) onClose();
        }}
      >
        <h2 id={titleId}>{mode === "create" ? "New node" : "Edit node"}</h2>
        <label>
          Title
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            required
            maxLength={200}
            autoFocus
          />
        </label>
        <label>
          Cost in points
          <input
            type="number"
            min={0}
            max={99}
            step={1}
            value={cost}
            onChange={(event) => setCost(Number.parseInt(event.target.value, 10) || 0)}
          />
        </label>
        <fieldset>
          <legend>Hard prerequisites</legend>
          {candidates.length === 0 ? (
            <p className="quiet">No other nodes yet.</p>
          ) : (
            <ul className="prereq-picks">
              {candidates.map((candidate) => {
                const cycle =
                  node !== null ? cycleIfAdded(plan, node.id, candidate.id) : null;
                const checked = prerequisiteIds.includes(candidate.id);
                return (
                  <li key={candidate.id}>
                    <label className={cycle ? "disabled" : undefined}>
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={Boolean(cycle)}
                        onChange={(event) => {
                          setPrerequisiteIds((current) =>
                            event.target.checked
                              ? [...current, candidate.id]
                              : current.filter((id) => id !== candidate.id),
                          );
                        }}
                      />
                      <span>
                        {candidate.title}
                        {cycle ? (
                          <span className="node-reason">{cycle.message}</span>
                        ) : null}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </fieldset>
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="detail-actions">
          <button type="submit" className="primary">
            {mode === "create" ? "Create" : "Save"}
          </button>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </dialog>
  );
}
