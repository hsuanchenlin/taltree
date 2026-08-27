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
        The talent tree is the main workspace. Hard prerequisites point downward.
        Selecting a node explains its cost, whether it fits remaining budget, what
        it would unlock immediately, and which dependents stay blocked with their
        direct remaining prerequisite. Switch to the list if you want the same plan
        grouped by state.
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
              <kbd>j</kbd> / <kbd>k</kbd>
            </th>
            <td>Next / previous node in list order</td>
          </tr>
          <tr>
            <th>
              <kbd>↑</kbd> <kbd>↓</kbd> <kbd>←</kbd> <kbd>→</kbd>
            </th>
            <td>Nearby node on the tree (list order in list view)</td>
          </tr>
          <tr>
            <th>
              <kbd>v</kbd>
            </th>
            <td>Toggle talent tree and list</td>
          </tr>
          <tr>
            <th>
              <kbd>+</kbd> / <kbd>-</kbd> / <kbd>0</kbd>
            </th>
            <td>Zoom in, zoom out, or fit the tree</td>
          </tr>
          <tr>
            <th>
              <kbd>f</kbd>
            </th>
            <td>Center the selected node on the tree</td>
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
        Status is named in words and marked with a glyph and distinct styling,
        not colour alone. Drag anywhere on the tree to pan; scroll to zoom. The
        plan is saved on this device as JSON. Export a copy; Taltree never uploads
        it.
      </p>
      <div className="detail-actions">
        <button type="button" className="primary" onClick={onClose}>
          Close
        </button>
      </div>
    </dialog>
  );
}
