import { useCallback, useEffect, useId, useRef, useState } from "react";
import { DIAGNOSTICS_STORAGE_KEY, formatDiagnostics } from "../diagnostics";
import type { DiagnosticsSnapshot } from "../diagnostics";

/**
 * The diagnostics panel: what the board actually is on this device, why it
 * might be blank, and one button that puts the whole snapshot on the clipboard.
 * It reads facts only - nothing here changes the plan.
 */

interface DiagnosticsDialogProps {
  open: boolean;
  onClose: () => void;
  /** Measures the app now and leaves a copy in local storage. */
  collect: () => DiagnosticsSnapshot;
}

type CopyState = "idle" | "copied" | "failed";

export function DiagnosticsDialog({
  open,
  onClose,
  collect,
}: DiagnosticsDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const titleId = useId();
  const [snapshot, setSnapshot] = useState<DiagnosticsSnapshot | null>(null);
  const [copyState, setCopyState] = useState<CopyState>("idle");

  const refresh = useCallback(() => {
    setCopyState("idle");
    setSnapshot(collect());
  }, [collect]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      // Measure on open: the panel must describe the board as it is right now.
      refresh();
      dialog.showModal();
    }
    if (!open && dialog.open) dialog.close();
  }, [open, refresh]);

  const text = snapshot ? formatDiagnostics(snapshot) : "";

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopyState("copied");
      return;
    } catch {
      // Clipboard permission can be refused outright; fall back to a selection
      // the person can copy by hand rather than leaving them with nothing.
      const area = textRef.current;
      if (area) {
        area.focus();
        area.select();
      }
      setCopyState("failed");
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="modal diagnostics"
      aria-labelledby={titleId}
      onClose={onClose}
      onCancel={onClose}
    >
      <h2 id={titleId}>Diagnostics</h2>
      <p>
        A read-only snapshot of how this device is drawing the tree. It never
        leaves the browser: copy it, or read{" "}
        <code>{DIAGNOSTICS_STORAGE_KEY}</code> from local storage later.
      </p>

      {snapshot ? (
        <>
          <section className="diag-findings" aria-label="Findings">
            <h3>What this looks like</h3>
            {snapshot.findings.length === 0 ? (
              <p className="quiet">
                Nothing looks wrong: the tree is inside the board and the
                renderer is painting.
              </p>
            ) : (
              <ul>
                {snapshot.findings.map((finding) => (
                  <li key={finding}>{finding}</li>
                ))}
              </ul>
            )}
          </section>

          <div className="diag-grid">
            <Facts
              title="Renderer"
              rows={[
                ["Chosen", snapshot.renderer.preference],
                ["Active", activeLabel(snapshot)],
                ["WebGL available", yesNo(snapshot.renderer.webglAvailable)],
                ["Relic slab failed", yesNo(snapshot.renderer.pixiFailed)],
              ]}
            />
            <Facts
              title="WebGL"
              rows={[
                ["Supported", yesNo(snapshot.webgl.supported)],
                ["Version", snapshot.webgl.version ?? "none"],
                [
                  "GPU vendor",
                  snapshot.webgl.unmaskedVendor ?? snapshot.webgl.vendor ?? "unknown",
                ],
                [
                  "GPU renderer",
                  snapshot.webgl.unmaskedRenderer ??
                    snapshot.webgl.renderer ??
                    "unknown",
                ],
                ["Max texture", numberOr(snapshot.webgl.maxTextureSize)],
                ["Stencil", yesNo(snapshot.webgl.stencil)],
                ["Probe failure", snapshot.webgl.failure ?? "none"],
              ]}
            />
            <Facts
              title="Surface"
              rows={[
                ["Board", sizeOf(snapshot.surface.viewport)],
                ["Pixi host", sizeOf(snapshot.surface.host)],
                [
                  "Canvas CSS",
                  snapshot.surface.canvas
                    ? `${round(snapshot.surface.canvas.cssWidth)} x ${round(snapshot.surface.canvas.cssHeight)}`
                    : "no canvas",
                ],
                [
                  "Canvas buffer",
                  snapshot.surface.canvas
                    ? `${snapshot.surface.canvas.backingWidth} x ${snapshot.surface.canvas.backingHeight}`
                    : "no canvas",
                ],
                [
                  "Device pixel ratio",
                  String(snapshot.environment.devicePixelRatio),
                ],
              ]}
            />
            <Facts
              title="Pixi"
              rows={
                snapshot.pixi
                  ? [
                      ["Initialised", yesNo(snapshot.pixi.isInitialised)],
                      ["Renderer", snapshot.pixi.rendererType],
                      ["Resolution", String(snapshot.pixi.resolution)],
                      ["Stage children", String(snapshot.pixi.stageChildren)],
                      ["Frames drawn", String(snapshot.pixi.framesRendered)],
                      ["World bounds", boundsOf(snapshot.pixi.worldBounds)],
                      [
                        "Camera",
                        `x ${round(snapshot.pixi.camera.x)}, y ${round(snapshot.pixi.camera.y)}, zoom ${snapshot.pixi.camera.k.toFixed(2)}`,
                      ],
                    ]
                  : [["State", "not mounted"]]
              }
            />
            <Facts
              title="Plan"
              rows={[
                ["Title", snapshot.plan.title],
                ["Nodes", String(snapshot.plan.nodeCount)],
                ["Edges", String(snapshot.plan.edgeCount)],
                [
                  "Layout",
                  `${snapshot.plan.layout.width} x ${snapshot.plan.layout.height}`,
                ],
              ]}
            />
            <Facts
              title="Environment"
              rows={[
                [
                  "Window",
                  `${snapshot.environment.innerWidth} x ${snapshot.environment.innerHeight}`,
                ],
                ["Reduced motion", yesNo(snapshot.environment.reducedMotion)],
                ["Colour scheme", snapshot.environment.colorScheme],
                ["Language", snapshot.environment.language],
                ["Captured at", snapshot.capturedAt],
              ]}
            />
          </div>

          <section className="diag-errors" aria-label="Captured errors">
            <h3>Captured errors ({snapshot.events.length})</h3>
            {snapshot.events.length === 0 ? (
              <p className="quiet">No errors or rejections were captured.</p>
            ) : (
              <ol>
                {snapshot.events.map((event) => (
                  <li key={`${event.at}-${event.source}-${event.message}`}>
                    <code>{event.source}</code> · {event.at}
                    <br />
                    {event.message}
                  </li>
                ))}
              </ol>
            )}
          </section>

          <label className="diag-json">
            <span className="sr-only">Diagnostics JSON</span>
            <textarea ref={textRef} readOnly rows={6} value={text} />
          </label>

          <p className="quiet" aria-live="polite">
            {copyState === "copied"
              ? "Copied to the clipboard."
              : copyState === "failed"
                ? "The clipboard was refused; the JSON above is selected, copy it by hand."
                : `Also saved to local storage as ${DIAGNOSTICS_STORAGE_KEY}.`}
          </p>
        </>
      ) : (
        <p className="quiet">Collecting…</p>
      )}

      <div className="detail-actions">
        <button type="button" className="primary" onClick={() => void copy()}>
          Copy diagnostics
        </button>
        <button type="button" onClick={refresh}>
          Refresh
        </button>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
    </dialog>
  );
}

function Facts({
  title,
  rows,
}: {
  title: string;
  rows: readonly (readonly [string, string])[];
}) {
  return (
    <section className="diag-card">
      <h3>{title}</h3>
      <dl>
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function activeLabel(snapshot: DiagnosticsSnapshot): string {
  if (snapshot.renderer.active === "relic") return "relic slab (WebGL)";
  if (snapshot.renderer.active === "classic") return "classic tree (SVG/DOM)";
  return "list";
}

function yesNo(value: boolean): string {
  return value ? "yes" : "no";
}

function numberOr(value: number | null): string {
  return value === null ? "unknown" : String(value);
}

function sizeOf(size: { width: number; height: number } | null): string {
  return size ? `${round(size.width)} x ${round(size.height)}` : "not mounted";
}

function boundsOf(
  bounds: { x: number; y: number; width: number; height: number } | null,
): string {
  if (!bounds) return "unknown";
  return `x ${round(bounds.x)}, y ${round(bounds.y)}, ${round(bounds.width)} x ${round(bounds.height)}`;
}

function round(value: number): number {
  return Math.round(value);
}
