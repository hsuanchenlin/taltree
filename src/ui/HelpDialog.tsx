import { useEffect, useId, useRef } from "react";

interface HelpDialogProps {
  open: boolean;
  onClose: () => void;
}

export function HelpDialog({ open, onClose }: HelpDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      className="modal"
      aria-labelledby={titleId}
      onClose={onClose}
      onCancel={onClose}
    >
      <h2 id={titleId}>Using Taltree</h2>
      <p>
        Spend today's point budget on the frontier. Selecting a node explains its
        cost, what it would unlock immediately, and which dependents stay blocked
        with their direct remaining prerequisite.
      </p>
      <p>
        Unused budget expires when the date changes. Unfinished work stays in the
        plan. Deferring only hides a node for today. There are no streaks or
        penalties.
      </p>
      <table className="keys">
        <caption>Keyboard</caption>
        <tbody>
          <tr>
            <th>
              <kbd>j</kbd> / <kbd>↓</kbd>
            </th>
            <td>Next node</td>
          </tr>
          <tr>
            <th>
              <kbd>k</kbd> / <kbd>↑</kbd>
            </th>
            <td>Previous node</td>
          </tr>
          <tr>
            <th>
              <kbd>c</kbd>
            </th>
            <td>Complete the selected eligible node</td>
          </tr>
          <tr>
            <th>
              <kbd>d</kbd>
            </th>
            <td>Defer today</td>
          </tr>
          <tr>
            <th>
              <kbd>u</kbd>
            </th>
            <td>Return a deferred node to the frontier</td>
          </tr>
          <tr>
            <th>
              <kbd>n</kbd>
            </th>
            <td>New node</td>
          </tr>
          <tr>
            <th>
              <kbd>e</kbd>
            </th>
            <td>Edit selected node</td>
          </tr>
          <tr>
            <th>
              <kbd>?</kbd>
            </th>
            <td>This help</td>
          </tr>
          <tr>
            <th>
              <kbd>Esc</kbd>
            </th>
            <td>Close dialog</td>
          </tr>
        </tbody>
      </table>
      <p>
        Status is named in words and marked with a glyph, not colour alone. The
        plan is saved on this device as JSON. Export a copy; Taltree never
        uploads it.
      </p>
      <div className="detail-actions">
        <button type="button" className="primary" onClick={onClose}>
          Close
        </button>
      </div>
    </dialog>
  );
}
