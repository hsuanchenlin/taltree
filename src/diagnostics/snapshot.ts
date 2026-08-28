import { contentOnScreen, visibleContentSize } from "../graph";
import type {
  ActiveRenderer,
  DiagnosticsInput,
  DiagnosticsSnapshot,
  RendererChoice,
  RendererFacts,
} from "./types";

/**
 * Pure assembly of a diagnostics snapshot, plus the findings that turn raw
 * facts into the sentence someone can act on. Everything here is
 * browser-free so it can be unit tested; the measuring lives in `collect`.
 */

export const DIAGNOSTICS_STORAGE_KEY = "taltree.diagnostics.v1";

/** Difference in CSS pixels above which a canvas is treated as out of step. */
const SIZE_TOLERANCE = 1;

/**
 * What the renderer state means. The relic slab counts as *failed* only when
 * it was asked for, WebGL was there to run it, and the classic tree is on
 * screen anyway - a machine with no WebGL at all never had a slab to fail.
 */
export function rendererFacts(
  preference: RendererChoice,
  active: ActiveRenderer,
  webglAvailable: boolean,
): RendererFacts {
  return {
    preference,
    active,
    webglAvailable,
    pixiFailed: preference === "relic" && active === "classic" && webglAvailable,
  };
}

export function buildDiagnostics(input: DiagnosticsInput): DiagnosticsSnapshot {
  return { ...input, findings: diagnosticFindings(input) };
}

/**
 * What the facts say, in order of how much it explains a blank board. An empty
 * list means nothing looks wrong; the panel says so rather than staying silent.
 */
export function diagnosticFindings(input: DiagnosticsInput): string[] {
  const findings: string[] = [];
  const { renderer, webgl, surface, pixi, plan } = input;

  if (plan.nodeCount === 0) {
    findings.push("The plan has no nodes, so the board has nothing to draw.");
  }
  if (!webgl.supported) {
    findings.push(
      `WebGL is unavailable${webgl.failure ? ` (${webgl.failure})` : ""}, so the relic slab cannot run here. The classic SVG tree is the working renderer on this device.`,
    );
  }
  if (renderer.pixiFailed) {
    findings.push(
      "The relic slab failed after mounting and the classic SVG tree took over.",
    );
  }
  if (renderer.active !== "relic") return findings;

  if (!pixi) {
    findings.push(
      "The relic slab is the active renderer but never reported any Pixi state: it did not finish mounting.",
    );
    return findings;
  }
  if (!pixi.isInitialised) {
    findings.push("Pixi reports that its application never finished initialising.");
  }
  if (pixi.framesRendered === 0) {
    findings.push(
      "Pixi has not presented a single frame, so the canvas still shows its clear colour.",
    );
  }
  if (pixi.stageChildren === 0) {
    findings.push("The Pixi stage has no children: the scene was never attached.");
  }

  const canvas = surface.canvas;
  if (canvas && (canvas.backingWidth === 0 || canvas.backingHeight === 0)) {
    findings.push(
      `The canvas drawing buffer is ${canvas.backingWidth}x${canvas.backingHeight}: there are no pixels to paint into.`,
    );
  }
  if (canvas && (canvas.cssWidth === 0 || canvas.cssHeight === 0)) {
    findings.push(
      `The canvas is laid out at ${canvas.cssWidth}x${canvas.cssHeight} CSS pixels: it is collapsed or clipped away.`,
    );
  }
  if (canvas && surface.host && outOfStep(canvas, surface.host)) {
    findings.push(
      `The canvas (${round(canvas.cssWidth)}x${round(canvas.cssHeight)}) does not match its host (${round(surface.host.width)}x${round(surface.host.height)}): a container resize was missed, so the board shows the wrong slice of the scene.`,
    );
  }

  if (surface.viewport && surface.viewport.width > 0 && surface.viewport.height > 0) {
    const viewport = surface.viewport;
    if (!contentOnScreen(plan.layout, pixi.camera, viewport)) {
      findings.push(
        `The tree sits entirely outside the board: camera ${describeCamera(pixi.camera)} maps a ${plan.layout.width}x${plan.layout.height} tree outside the ${round(viewport.width)}x${round(viewport.height)} board. Press Fit to bring it back.`,
      );
    } else {
      const visible = visibleContentSize(plan.layout, pixi.camera, viewport);
      if (visible.width < 24 || visible.height < 24) {
        findings.push(
          `Only ${round(visible.width)}x${round(visible.height)} pixels of the tree are inside the board; the rest is panned off the edge.`,
        );
      }
    }
  }

  if (input.events.length > 0) {
    findings.push(
      `${input.events.length} error${input.events.length === 1 ? " was" : "s were"} captured on this page; see the errors section.`,
    );
  }
  return findings;
}

/** The snapshot, as the text the Copy button puts on the clipboard. */
export function formatDiagnostics(snapshot: DiagnosticsSnapshot): string {
  return `${JSON.stringify(snapshot, null, 2)}\n`;
}

/**
 * Leave a copy on the device. A tester who has already closed the panel (or
 * the tab) can still be asked for `taltree.diagnostics.v1` afterwards.
 */
export function writeDiagnostics(
  storage: Pick<Storage, "setItem">,
  snapshot: DiagnosticsSnapshot,
): void {
  try {
    storage.setItem(DIAGNOSTICS_STORAGE_KEY, formatDiagnostics(snapshot));
  } catch {
    // A full or blocked storage must never break the panel it is reporting on.
  }
}

export function readDiagnostics(
  storage: Pick<Storage, "getItem">,
): DiagnosticsSnapshot | null {
  try {
    const raw = storage.getItem(DIAGNOSTICS_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as DiagnosticsSnapshot;
  } catch {
    return null;
  }
}

function outOfStep(
  canvas: { cssWidth: number; cssHeight: number },
  host: { width: number; height: number },
): boolean {
  return (
    Math.abs(canvas.cssWidth - host.width) > SIZE_TOLERANCE ||
    Math.abs(canvas.cssHeight - host.height) > SIZE_TOLERANCE
  );
}

function describeCamera(camera: { x: number; y: number; k: number }): string {
  return `x ${round(camera.x)}, y ${round(camera.y)}, zoom ${camera.k.toFixed(2)}`;
}

function round(value: number): number {
  return Math.round(value);
}
