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
import type {
  Camera,
  CameraVelocity,
  LaidOutGraph,
  LaidOutNode,
  PointerSample,
  ViewportSize,
} from "../graph";
import {
  CAMERA_MOTION,
  centerCameraOn,
  dragVelocity,
  easeOutCubic,
  ensureVisible,
  fitCamera,
  lerpCamera,
  READABLE_CAMERA,
  rebaseDragOrigin,
  shouldGlide,
  stepMomentum,
  zoomAbout,
  zoomEase,
  zoomSettled,
} from "../graph";
import { KIND_LABEL, pointsLabel } from "./format";
import { KindMark } from "./glyphs";
import { TalentTreeDomWorld } from "./TalentTreeDomWorld";
import { isPointInsideViewport } from "./talentTreeInteraction";

interface TalentTreeProps {
  tree: LaidOutGraph;
  remaining: number;
  explanation: ChoiceExplanation | null;
  onSelect: (id: string) => void;
  /** Increments when the `f` key asks the camera to center the selected node. */
  focusSignal?: number;
}

const ZOOM_STEP = 1.15;
const WHEEL_STEP = 1.08;
const PAN_THRESHOLD = 4;
const DOUBLE_TAP_MS = 350;
const DOUBLE_TAP_PX = 30;

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
  samples: PointerSample[];
}

interface PinchGesture {
  baseCamera: Camera;
  startDistance: number;
  startMidX: number;
  startMidY: number;
}

/** Camera motion owned by the rAF loop rather than by a gesture. */
interface CameraMotion {
  glide: CameraVelocity | null;
  zoomTarget: Camera | null;
  focus: { from: Camera; to: Camera; start: number; nodeId: string } | null;
}

interface PixiErrorBoundaryProps {
  fallback: ReactNode;
  onFailed: () => void;
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
    this.props.onFailed();
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
  focusSignal = 0,
}: TalentTreeProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const treeRef = useRef(tree);
  treeRef.current = tree;
  const panRef = useRef<PanGesture | null>(null);
  const pinchRef = useRef<PinchGesture | null>(null);
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const lastTapRef = useRef<{ t: number; x: number; y: number } | null>(null);
  const suppressClickRef = useRef(false);
  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, k: 1 });
  // Mirror of the camera state for event handlers and the rAF loop, which run
  // outside React's render cycle and must never read a stale closure.
  const cameraRef = useRef(camera);
  const motionRef = useRef<CameraMotion>({
    glide: null,
    zoomTarget: null,
    focus: null,
  });
  const rafRef = useRef<number | null>(null);
  const lastFrameRef = useRef(0);
  const [reducedMotion] = useState(
    () =>
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [panning, setPanning] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  // Mirror for the window-level pointer handlers, which are registered once and
  // must hit-test against the hover the renderer is actually showing.
  const hoveredIdRef = useRef(hoveredId);
  hoveredIdRef.current = hoveredId;
  const [pixiFailed, setPixiFailed] = useState(false);
  const layoutKey = `${tree.width}x${tree.height}:${tree.nodes.map((node) => node.id).join(",")}`;
  const selectedId = tree.nodes.find((node) => node.selected)?.id ?? null;
  const hasNodes = tree.nodes.length > 0;
  // Intent to mount the slab, versus the slab actually rendering. Everything
  // the relic surface owns - the dark board, its hit test, its screen-reader
  // list - must follow the latter, or the DOM fallback inherits a dark
  // background it was never styled for and a second, invisible click target.
  const usePixi = hasNodes && canUseWebGL();
  const pixiLive = usePixi && !pixiFailed;
  const onPixiFailed = useCallback(() => setPixiFailed(true), []);

  const applyCamera = useCallback((next: Camera) => {
    cameraRef.current = next;
    setCamera(next);
  }, []);

  /** Halt every camera motion, catching the camera exactly where it is. */
  const stopMotion = useCallback(() => {
    motionRef.current = { glide: null, zoomTarget: null, focus: null };
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  /**
   * The single rAF driver for camera motion: `f`/double-click focus
   * animation, smooth zoom toward its target, and momentum glide after a
   * flick. It runs only while at least one motion is active; reduced motion
   * never reaches it because callers apply their targets immediately.
   */
  const ensureMotionLoop = useCallback(() => {
    if (rafRef.current !== null) return;
    lastFrameRef.current = performance.now();
    const frame = (now: number) => {
      const motion = motionRef.current;
      // Clamp tab-switch gaps so a hidden tab cannot slingshot the camera.
      const dt = Math.min(100, Math.max(0, now - lastFrameRef.current));
      lastFrameRef.current = now;
      let next = cameraRef.current;
      if (motion.focus) {
        const t = (now - motion.focus.start) / CAMERA_MOTION.focusDurationMs;
        if (t >= 1) {
          next = motion.focus.to;
          motion.focus = null;
        } else {
          next = lerpCamera(motion.focus.from, motion.focus.to, easeOutCubic(t));
        }
      } else {
        if (motion.zoomTarget) {
          next = lerpCamera(next, motion.zoomTarget, zoomEase(dt));
          if (zoomSettled(next, motion.zoomTarget)) {
            next = motion.zoomTarget;
            motion.zoomTarget = null;
          }
        }
        if (motion.glide) {
          const stepped = stepMomentum(next, motion.glide, dt);
          next = stepped.camera;
          motion.glide =
            stepped.velocity.vx === 0 && stepped.velocity.vy === 0
              ? null
              : stepped.velocity;
        }
      }
      applyCamera(next);
      if (motion.focus || motion.zoomTarget || motion.glide) {
        rafRef.current = requestAnimationFrame(frame);
      } else {
        rafRef.current = null;
      }
    };
    rafRef.current = requestAnimationFrame(frame);
  }, [applyCamera]);

  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  // The boundary forgets its own failure whenever it unmounts, which is exactly
  // when `usePixi` goes false. This copy has to forget on the same transition,
  // or a slab that remounts and initialises fine stays marked as failed.
  useEffect(() => {
    if (!usePixi) return;
    return () => setPixiFailed(false);
  }, [usePixi]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    stopMotion();
    const selected = treeRef.current.nodes.find((node) => node.selected);
    if (!selected || viewport.clientWidth <= 0) {
      applyCamera(READABLE_CAMERA);
      return;
    }
    applyCamera(ensureVisible(selected, READABLE_CAMERA, sizeOf(viewport)));
  }, [layoutKey, applyCamera, stopMotion]);

  useEffect(() => {
    const viewport = viewportRef.current;
    const node = treeRef.current.nodes.find((item) => item.id === selectedId);
    if (!viewport || !node) return;
    // A double-click/double-tap selects *and* starts a focus animation on the
    // same node; the animation owns the camera in that case (centering implies
    // visible), so the selection effect must not cancel it.
    const focus = motionRef.current.focus;
    if (focus && focus.nodeId === selectedId) return;
    // Selection changes (keyboard included) always win over a glide.
    stopMotion();
    applyCamera(ensureVisible(node, cameraRef.current, sizeOf(viewport)));
    if (!viewport.contains(document.activeElement)) return;
    const button = viewport.querySelector<HTMLButtonElement>(
      '.tree-node[data-selected="true"]',
    );
    if (button && button !== document.activeElement) {
      button.focus({ preventScroll: true });
    }
  }, [selectedId, applyCamera, stopMotion]);

  /**
   * The one way a zoom or fit reaches the camera. A live drag positions the
   * camera absolutely from its own origin, so it - not the motion loop - owns
   * the camera while a finger or button is down: the target lands immediately
   * and the drag's origin absorbs it, instead of being interpolated frame by
   * frame against a base the drag keeps overwriting.
   */
  const applyZoomTarget = useCallback(
    (target: Camera) => {
      const motion = motionRef.current;
      motion.glide = null;
      motion.focus = null;
      const pan = panRef.current;
      if (pan || reducedMotion || zoomSettled(cameraRef.current, target)) {
        motion.zoomTarget = null;
        if (pan) {
          const rebased = rebaseDragOrigin(pan, cameraRef.current, target);
          pan.camX = rebased.camX;
          pan.camY = rebased.camY;
        }
        applyCamera(target);
        return;
      }
      motion.zoomTarget = target;
      ensureMotionLoop();
    },
    [applyCamera, ensureMotionLoop, reducedMotion],
  );

  const zoomBy = useCallback(
    (factor: number, focus?: { x: number; y: number }) => {
      const viewport = viewportRef.current;
      if (!viewport) return;
      const point = focus ?? {
        x: viewport.clientWidth / 2,
        y: viewport.clientHeight / 2,
      };
      const base = motionRef.current.zoomTarget ?? cameraRef.current;
      applyZoomTarget(zoomAbout(base, factor, point));
    },
    [applyZoomTarget],
  );

  const fitToViewport = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    applyZoomTarget(fitCamera(treeRef.current, sizeOf(viewport)));
  }, [applyZoomTarget]);

  /** Smoothly center the camera on a node (`f`, double-click, double-tap). */
  const focusNode = useCallback(
    (node: LaidOutNode) => {
      const viewport = viewportRef.current;
      if (!viewport) return;
      stopMotion();
      const target = centerCameraOn(
        node,
        cameraRef.current,
        sizeOf(viewport),
      );
      if (reducedMotion) {
        applyCamera(target);
        return;
      }
      motionRef.current.focus = {
        from: cameraRef.current,
        to: target,
        start: performance.now(),
        nodeId: node.id,
      };
      ensureMotionLoop();
    },
    [applyCamera, ensureMotionLoop, reducedMotion, stopMotion],
  );

  // The signal is owned by App and outlives this component, so only a change
  // seen by *this* mount is a focus request; a remount inherits the last value
  // without replaying its animation.
  const handledFocusRef = useRef(focusSignal);
  useEffect(() => {
    if (handledFocusRef.current === focusSignal) return;
    handledFocusRef.current = focusSignal;
    const node = treeRef.current.nodes.find((item) => item.selected);
    if (node) focusNode(node);
  }, [focusSignal, focusNode]);

  /** Second finger on the viewport converts the pan into a pinch zoom. */
  const beginPinchGesture = useCallback(() => {
    const [a, b] = [...pointersRef.current.values()];
    if (!a || !b) return;
    panRef.current = null;
    setPanning(false);
    suppressClickRef.current = true;
    pinchRef.current = {
      baseCamera: cameraRef.current,
      startDistance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
      startMidX: (a.x + b.x) / 2,
      startMidY: (a.y + b.y) / 2,
    };
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
      // Pinch detection reads `pointersRef.size`, so every gesture end has to
      // drop its pointer - including the mouse-released-outside-the-window path.
      pointersRef.current.delete(pan.pointerId);
      panRef.current = null;
      suppressClickRef.current = pan.moved && retainClickSuppression;
      setPanning(false);
    }
    function onMove(event: PointerEvent) {
      const point = pointersRef.current.get(event.pointerId);
      if (point) {
        point.x = event.clientX;
        point.y = event.clientY;
      }
      const pinch = pinchRef.current;
      if (pinch) {
        const [a, b] = [...pointersRef.current.values()];
        const viewport = viewportRef.current;
        if (!a || !b || !viewport) return;
        const rect = viewport.getBoundingClientRect();
        const distance = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
        const midX = (a.x + b.x) / 2;
        const midY = (a.y + b.y) / 2;
        const panned: Camera = {
          ...pinch.baseCamera,
          x: pinch.baseCamera.x + (midX - pinch.startMidX),
          y: pinch.baseCamera.y + (midY - pinch.startMidY),
        };
        applyZoomTarget(
          zoomAbout(panned, distance / pinch.startDistance, {
            x: midX - rect.left,
            y: midY - rect.top,
          }),
        );
        return;
      }
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
      pan.samples.push({ x: event.clientX, y: event.clientY, t: event.timeStamp });
      while (
        pan.samples.length > 2 &&
        event.timeStamp - (pan.samples[0]?.t ?? 0) >
          CAMERA_MOTION.velocityWindowMs * 2
      ) {
        pan.samples.shift();
      }
      applyCamera({
        ...cameraRef.current,
        x: pan.camX + dx,
        y: pan.camY + dy,
      });
    }
    function onEnd(event: PointerEvent) {
      pointersRef.current.delete(event.pointerId);
      const pinch = pinchRef.current;
      if (pinch) {
        if (pointersRef.current.size >= 2) return;
        pinchRef.current = null;
        const remaining = [...pointersRef.current.entries()][0];
        if (remaining) {
          // One finger stays down after a pinch: keep panning from where the
          // pinch left the camera, with no jump and no inherited velocity. The
          // pending smooth-zoom target has to go with it, or every frame of the
          // new pan gets lerped back toward the pinch's camera.
          stopMotion();
          const [pointerId, point] = remaining;
          panRef.current = {
            pointerId,
            startX: point.x,
            startY: point.y,
            camX: cameraRef.current.x,
            camY: cameraRef.current.y,
            moved: true,
            samples: [{ x: point.x, y: point.y, t: event.timeStamp }],
          };
        } else {
          setPanning(false);
          suppressClickRef.current = true;
        }
        return;
      }
      const pan = panRef.current;
      if (!pan || event.pointerId !== pan.pointerId) return;
      const viewport = viewportRef.current;
      if (
        pan.moved &&
        event.type === "pointerup" &&
        !reducedMotion &&
        pointersRef.current.size === 0
      ) {
        const velocity = dragVelocity(pan.samples);
        if (shouldGlide(velocity)) {
          motionRef.current.glide = velocity;
          motionRef.current.focus = null;
          ensureMotionLoop();
        }
      }
      if (
        !pan.moved &&
        event.type === "pointerup" &&
        event.pointerType !== "mouse" &&
        pixiLive &&
        viewport
      ) {
        onDoubleTap(event, viewport);
      }
      endGesture(
        pan,
        event.type === "pointerup" &&
          Boolean(
            viewport &&
              isPointInsideViewport(viewport.getBoundingClientRect(), event),
          ),
      );
    }
    function onDoubleTap(event: PointerEvent, viewport: HTMLElement) {
      const last = lastTapRef.current;
      lastTapRef.current = { t: event.timeStamp, x: event.clientX, y: event.clientY };
      if (
        !last ||
        event.timeStamp - last.t > DOUBLE_TAP_MS ||
        Math.hypot(event.clientX - last.x, event.clientY - last.y) > DOUBLE_TAP_PX
      ) {
        return;
      }
      lastTapRef.current = null;
      const rect = viewport.getBoundingClientRect();
      const hit = hitTestNode(
        treeRef.current.nodes,
        { x: event.clientX - rect.left, y: event.clientY - rect.top },
        cameraRef.current,
        hoveredIdRef.current,
      );
      if (hit) {
        onSelect(hit.id);
        focusNode(hit);
      }
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onEnd);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
    };
  }, [
    applyCamera,
    applyZoomTarget,
    ensureMotionLoop,
    focusNode,
    onSelect,
    pixiLive,
    reducedMotion,
    stopMotion,
  ]);

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
          className={`tree-viewport${panning ? " panning" : ""}${pixiLive ? " relic" : ""}`}
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
            const target = event.target;
            if (target instanceof Element && target.closest("a, input, select, textarea")) {
              return;
            }
            // A tap or click during a glide or animation catches the camera
            // exactly where it is - no jump, no rubber-band.
            stopMotion();
            pointersRef.current.set(event.pointerId, {
              x: event.clientX,
              y: event.clientY,
            });
            suppressClickRef.current = false;
            if (pointersRef.current.size >= 2) {
              beginPinchGesture();
              return;
            }
            if (panRef.current) return;
            panRef.current = {
              pointerId: event.pointerId,
              startX: event.clientX,
              startY: event.clientY,
              camX: cameraRef.current.x,
              camY: cameraRef.current.y,
              moved: false,
              samples: [
                { x: event.clientX, y: event.clientY, t: event.timeStamp },
              ],
            };
          }}
          onDoubleClick={(event) => {
            if (!pixiLive) return;
            const viewport = viewportRef.current;
            if (!viewport) return;
            const rect = viewport.getBoundingClientRect();
            const hit = hitTestNode(
              treeRef.current.nodes,
              { x: event.clientX - rect.left, y: event.clientY - rect.top },
              cameraRef.current,
              hoveredId,
            );
            if (hit) {
              onSelect(hit.id);
              focusNode(hit);
            }
          }}
          onPointerMove={(event) => {
            if (!pixiLive || panRef.current?.moved) {
              setHoveredId(null);
              return;
            }
            const viewport = viewportRef.current;
            if (!viewport) return;
            const rect = viewport.getBoundingClientRect();
            const hit = hitTestNode(
              treeRef.current.nodes,
              { x: event.clientX - rect.left, y: event.clientY - rect.top },
              camera,
              hoveredId,
            );
            setHoveredId(hit?.id ?? null);
          }}
          onPointerLeave={() => setHoveredId(null)}
          onClickCapture={(event) => {
            if (!suppressClickRef.current) return;
            suppressClickRef.current = false;
            event.preventDefault();
            event.stopPropagation();
          }}
          onClick={(event) => {
            if (!pixiLive) return;
            const viewport = viewportRef.current;
            if (!viewport) return;
            const rect = viewport.getBoundingClientRect();
            const hit = hitTestNode(
              treeRef.current.nodes,
              { x: event.clientX - rect.left, y: event.clientY - rect.top },
              camera,
              hoveredId,
            );
            if (hit) onSelect(hit.id);
          }}
        >
          {usePixi ? (
            <PixiErrorBoundary
              onFailed={onPixiFailed}
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
                <TalentTreePixi
                  tree={tree}
                  camera={camera}
                  hoveredId={hoveredId}
                />
              </Suspense>
            </PixiErrorBoundary>
          ) : (
            <TalentTreeDomWorld tree={tree} camera={camera} onSelect={onSelect} />
          )}
        </div>
      )}
      {pixiLive ? (
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
