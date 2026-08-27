import {
  Component,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { canUseWebGL } from "../canvas/webgl";
import { hitTestNode } from "../canvas/relicGeometry";
import type { ChoiceExplanation } from "../domain/types";
import type { Camera, LaidOutGraph, ViewportSize } from "../graph";
import { ensureVisible, fitCamera, READABLE_CAMERA, zoomAbout } from "../graph";
import { KIND_LABEL, pointsLabel } from "./format";
import { KindMark } from "./glyphs";
import { TalentTreeDomWorld } from "./TalentTreeDomWorld";
import { isPointInsideViewport } from "./talentTreeInteraction";

interface TalentTreeProps {
  tree: LaidOutGraph;
  remaining: number;
  explanation: ChoiceExplanation | null;
  onSelect: (id: string) => void;
}

const ZOOM_STEP = 1.15;
const WHEEL_STEP = 1.08;
const PAN_THRESHOLD = 4;

// The relic slab (PixiJS) lives in its own chunk so first paint and the list
// view never wait on it. WebGL-less machines keep the SVG/DOM world.
const TalentTreePixi = lazy(() => import("./TalentTreePixi"));

interface PanGesture {
  pointerId: number;
  startX: number;
  startY: number;
  camX: number;
  camY: number;
  moved: boolean;
}

interface PixiErrorBoundaryProps {
  fallback: ReactNode;
  children: ReactNode;
}

/** Any Pixi init/render failure degrades to the SVG/DOM world. */
class PixiErrorBoundary extends Component<
  PixiErrorBoundaryProps,
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: unknown): void {
    console.error("Relic slab renderer failed; falling back to the DOM tree.", error);
  }

  render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export function TalentTree({
  tree,
  remaining,
  explanation,
  onSelect,
}: TalentTreeProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const treeRef = useRef(tree);
  treeRef.current = tree;
  const panRef = useRef<PanGesture | null>(null);
  const suppressClickRef = useRef(false);
  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, k: 1 });
  const [panning, setPanning] = useState(false);
  const layoutKey = `${tree.width}x${tree.height}:${tree.nodes.map((node) => node.id).join(",")}`;
  const selectedId = tree.nodes.find((node) => node.selected)?.id ?? null;
  const hasNodes = tree.nodes.length > 0;
  const usePixi = hasNodes && canUseWebGL();

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const selected = treeRef.current.nodes.find((node) => node.selected);
    if (!selected || viewport.clientWidth <= 0) {
      setCamera(READABLE_CAMERA);
      return;
    }
    setCamera(ensureVisible(selected, READABLE_CAMERA, sizeOf(viewport)));
  }, [layoutKey]);

  useEffect(() => {
    const viewport = viewportRef.current;
    const node = treeRef.current.nodes.find((item) => item.id === selectedId);
    if (!viewport || !node) return;
    setCamera((current) => ensureVisible(node, current, sizeOf(viewport)));
    if (!viewport.contains(document.activeElement)) return;
    const button = viewport.querySelector<HTMLButtonElement>(
      '.tree-node[data-selected="true"]',
    );
    if (button && button !== document.activeElement) {
      button.focus({ preventScroll: true });
    }
  }, [selectedId]);

  const zoomBy = useCallback((factor: number, focus?: { x: number; y: number }) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const point = focus ?? {
      x: viewport.clientWidth / 2,
      y: viewport.clientHeight / 2,
    };
    setCamera((current) => zoomAbout(current, factor, point));
  }, []);

  const fitToViewport = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    setCamera(fitCamera(treeRef.current, sizeOf(viewport)));
  }, []);

  useEffect(() => {
    const stage = viewportRef.current;
    if (!stage) return;
    function onWheel(event: WheelEvent) {
      const current = viewportRef.current;
      if (!current) return;
      event.preventDefault();
      const rect = current.getBoundingClientRect();
      zoomBy(event.deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP, {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      });
    }
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, [hasNodes, zoomBy]);

  useEffect(() => {
    function endGesture(pan: PanGesture, retainClickSuppression: boolean) {
      panRef.current = null;
      suppressClickRef.current = pan.moved && retainClickSuppression;
      setPanning(false);
    }
    function onMove(event: PointerEvent) {
      const pan = panRef.current;
      if (!pan || event.pointerId !== pan.pointerId) return;
      if (event.pointerType === "mouse" && event.buttons === 0) {
        const viewport = viewportRef.current;
        endGesture(
          pan,
          Boolean(
            viewport &&
              isPointInsideViewport(viewport.getBoundingClientRect(), event),
          ),
        );
        return;
      }
      const dx = event.clientX - pan.startX;
      const dy = event.clientY - pan.startY;
      if (!pan.moved) {
        if (Math.abs(dx) < PAN_THRESHOLD && Math.abs(dy) < PAN_THRESHOLD) return;
        pan.moved = true;
        setPanning(true);
      }
      setCamera((current) => ({ ...current, x: pan.camX + dx, y: pan.camY + dy }));
    }
    function onEnd(event: PointerEvent) {
      const pan = panRef.current;
      if (!pan || event.pointerId !== pan.pointerId) return;
      const viewport = viewportRef.current;
      endGesture(
        pan,
        event.type === "pointerup" &&
          Boolean(
            viewport &&
              isPointInsideViewport(viewport.getBoundingClientRect(), event),
          ),
      );
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onEnd);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
    };
  }, []);

  const spendLine = spendCopy(remaining, explanation);

  return (
    <section className="tree-board" aria-label="Talent tree">
      <div className="tree-chrome">
        <p className="tree-spend" aria-live="polite">
          {spendLine}
        </p>
        <div className="tree-zoom" role="group" aria-label="Tree navigation">
          <button type="button" onClick={() => zoomBy(1 / ZOOM_STEP)}>
            Zoom out
          </button>
          <button type="button" onClick={() => zoomBy(ZOOM_STEP)}>
            Zoom in
          </button>
          <button type="button" onClick={fitToViewport}>
            Fit
          </button>
        </div>
      </div>
      <ul className="tree-legend" aria-label="Node states">
        <li>
          <KindMark kind="eligible" />
        </li>
        <li>
          <KindMark kind="blocked" />
        </li>
        <li>
          <KindMark kind="deferred" />
        </li>
        <li>
          <KindMark kind="completed" />
        </li>
      </ul>
      <p className="sr-only">
        Directed talent tree. Prerequisites sit above what they unlock. Drag
        anywhere on the board to pan, scroll to zoom, and use arrow keys to move
        to a nearby node. The list view remains available as a keyboard-operable
        alternative.
      </p>
      {tree.nodes.length === 0 ? (
        <div className="tree-empty">
          <p>No nodes yet. Create one to start the tree.</p>
        </div>
      ) : (
        <div
          ref={viewportRef}
          className={`tree-viewport${panning ? " panning" : ""}${usePixi ? " relic" : ""}`}
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === "+" || event.key === "=") {
              event.preventDefault();
              zoomBy(ZOOM_STEP);
            } else if (event.key === "-" || event.key === "_") {
              event.preventDefault();
              zoomBy(1 / ZOOM_STEP);
            } else if (event.key === "0") {
              event.preventDefault();
              fitToViewport();
            }
          }}
          onPointerDown={(event) => {
            if (event.pointerType === "mouse" && event.button !== 0) return;
            if (panRef.current) return;
            const target = event.target;
            if (target instanceof Element && target.closest("a, input, select, textarea")) {
              return;
            }
            suppressClickRef.current = false;
            panRef.current = {
              pointerId: event.pointerId,
              startX: event.clientX,
              startY: event.clientY,
              camX: camera.x,
              camY: camera.y,
              moved: false,
            };
          }}
          onClickCapture={(event) => {
            if (!suppressClickRef.current) return;
            suppressClickRef.current = false;
            event.preventDefault();
            event.stopPropagation();
          }}
          onClick={(event) => {
            if (!usePixi) return;
            const viewport = viewportRef.current;
            if (!viewport) return;
            const rect = viewport.getBoundingClientRect();
            const hit = hitTestNode(
              treeRef.current.nodes,
              { x: event.clientX - rect.left, y: event.clientY - rect.top },
              camera,
            );
            if (hit) onSelect(hit.id);
          }}
        >
          {usePixi ? (
            <PixiErrorBoundary
              fallback={
                <TalentTreeDomWorld tree={tree} camera={camera} onSelect={onSelect} />
              }
            >
              <Suspense
                fallback={
                  <div className="tree-loading" role="status">
                    Loading the tree canvas…
                  </div>
                }
              >
                <TalentTreePixi tree={tree} camera={camera} />
              </Suspense>
            </PixiErrorBoundary>
          ) : (
            <TalentTreeDomWorld tree={tree} camera={camera} onSelect={onSelect} />
          )}
        </div>
      )}
      {usePixi ? (
        <ol className="sr-only" aria-label="Tree nodes">
          {tree.nodes.map((node) => (
            <li key={node.id}>
              {node.title}, {KIND_LABEL[node.kind]}, {pointsLabel(node.cost)}
              {node.caption ? `, ${node.caption}` : ""}
            </li>
          ))}
        </ol>
      ) : null}
      <p className="tree-hint quiet">
        Drag the board to pan. Scroll, or use the zoom controls, when the tree is denser than the board.
      </p>
    </section>
  );
}

function sizeOf(viewport: HTMLElement): ViewportSize {
  return { width: viewport.clientWidth, height: viewport.clientHeight };
}

function spendCopy(remaining: number, explanation: ChoiceExplanation | null): string {
  const remainingText = `${pointsLabel(remaining)} remaining`;
  if (!explanation || explanation.completed) {
    return `${remainingText}. Select an eligible node to see spend and what it unlocks.`;
  }
  if (explanation.deferredToday) {
    return `${remainingText}. Deferred today: it stays incomplete and returns to the frontier tomorrow.`;
  }
  if (!explanation.eligible) {
    const waiting = explanation.waitingOn.map((ref) => ref.title).join(", ");
    return `${remainingText}. Blocked until ${waiting || "its hard prerequisites"} ${
      explanation.waitingOn.length === 1 ? "is" : "are"
    } completed.`;
  }
  const after = Math.max(0, remaining - explanation.cost);
  const unlock =
    explanation.immediateUnlocks.length === 0
      ? "Nothing new becomes eligible."
      : `Immediately unlocks ${explanation.immediateUnlocks.map((ref) => ref.title).join(", ")}.`;
  if (!explanation.fitsBudget) {
    return `${remainingText}. Completing this spends ${pointsLabel(explanation.cost)} and exceeds the budget by ${pointsLabel(explanation.overBy)}. ${unlock}`;
  }
  return `${remainingText}. Completing this spends ${pointsLabel(explanation.cost)}, leaving ${pointsLabel(after)}. ${unlock}`;
}
