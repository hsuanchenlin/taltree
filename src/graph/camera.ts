import type { LaidOutGraph, LaidOutNode } from "./types";

export interface Camera {
  x: number;
  y: number;
  k: number;
}

export interface ViewportSize {
  width: number;
  height: number;
}

export const CAMERA_LIMITS = {
  minZoom: 0.25,
  maxZoom: 2.4,
  fitPadding: 16,
  visibleMargin: 20,
} as const;

export const READABLE_CAMERA: Camera = { x: 20, y: 20, k: 1 };

/**
 * Motion tuning for pan inertia, smooth zoom, and focus animation. These stay
 * here, next to the camera math, so the React tree never carries feel
 * constants. Velocities are screen pixels per second.
 */
export const CAMERA_MOTION = {
  /** Velocity retained per 60fps reference frame during a glide. */
  frictionPerFrame: 0.92,
  /** The frame the friction constant is quoted against. */
  referenceFrameMs: 1000 / 60,
  /** A glide slower than this (px per reference frame) snaps to rest. */
  stopPxPerFrame: 0.15,
  /** Release speed (px/s) below which a drag ends without a glide. */
  minGlidePxPerSecond: 40,
  /** Pointer-move history used to estimate release velocity. */
  velocityWindowMs: 100,
  /** Duration of the `f` / double-click focus animation. */
  focusDurationMs: 220,
  /** Share of the remaining zoom distance covered per reference frame. */
  zoomEasePerFrame: 0.28,
  /** A smooth zoom this close to its target (px and k) snaps to it. */
  zoomSnapPx: 0.5,
  zoomSnapK: 0.001,
} as const;

export interface CameraVelocity {
  vx: number;
  vy: number;
}

export interface PointerSample {
  x: number;
  y: number;
  /** Timestamp in milliseconds, from any monotonic clock. */
  t: number;
}

export function clampZoom(k: number): number {
  return Math.min(CAMERA_LIMITS.maxZoom, Math.max(CAMERA_LIMITS.minZoom, k));
}

export function zoomAbout(
  camera: Camera,
  factor: number,
  focus: { x: number; y: number },
): Camera {
  const k = clampZoom(camera.k * factor);
  const worldX = (focus.x - camera.x) / camera.k;
  const worldY = (focus.y - camera.y) / camera.k;
  return { k, x: focus.x - worldX * k, y: focus.y - worldY * k };
}

export function fitCamera(
  tree: Pick<LaidOutGraph, "width" | "height">,
  viewport: ViewportSize,
): Camera {
  if (viewport.width <= 0 || viewport.height <= 0) return { x: 0, y: 0, k: 1 };
  const pad = CAMERA_LIMITS.fitPadding;
  const k = clampZoom(
    Math.min(
      (viewport.width - pad * 2) / Math.max(tree.width, 1),
      (viewport.height - pad * 2) / Math.max(tree.height, 1),
      1,
    ),
  );
  return {
    k,
    x: (viewport.width - tree.width * k) / 2,
    y: (viewport.height - tree.height * k) / 2,
  };
}

export function ensureVisible(
  node: Pick<LaidOutNode, "x" | "y" | "width" | "height">,
  camera: Camera,
  viewport: ViewportSize,
): Camera {
  const margin = CAMERA_LIMITS.visibleMargin;
  const sx = camera.x + node.x * camera.k;
  const sy = camera.y + node.y * camera.k;
  const sw = node.width * camera.k;
  const sh = node.height * camera.k;
  let x = camera.x;
  let y = camera.y;
  if (sx < margin) x += margin - sx;
  if (sy < margin) y += margin - sy;
  if (sx + sw > viewport.width - margin) x -= sx + sw - (viewport.width - margin);
  if (sy + sh > viewport.height - margin) y -= sy + sh - (viewport.height - margin);
  if (x === camera.x && y === camera.y) return camera;
  return { ...camera, x, y };
}

/** The camera that puts a node's box center at the viewport center, keeping zoom. */
export function centerCameraOn(
  node: Pick<LaidOutNode, "x" | "y" | "width" | "height">,
  camera: Camera,
  viewport: ViewportSize,
): Camera {
  const cx = node.x + node.width / 2;
  const cy = node.y + node.height / 2;
  return {
    k: camera.k,
    x: viewport.width / 2 - cx * camera.k,
    y: viewport.height / 2 - cy * camera.k,
  };
}

export function speedOf(velocity: CameraVelocity): number {
  return Math.hypot(velocity.vx, velocity.vy);
}

/** Whether a released drag is fast enough to coast. */
export function shouldGlide(velocity: CameraVelocity): boolean {
  return speedOf(velocity) > CAMERA_MOTION.minGlidePxPerSecond;
}

/** Whether a gliding camera is slow enough to snap to rest. */
export function glideStopped(velocity: CameraVelocity): boolean {
  const stopPxPerSecond =
    CAMERA_MOTION.stopPxPerFrame * (1000 / CAMERA_MOTION.referenceFrameMs);
  return speedOf(velocity) < stopPxPerSecond;
}

/**
 * Release velocity of a drag from its recent pointer samples, using the oldest
 * sample inside the velocity window so a slow final wobble does not kill a
 * flick. Returns zero when the samples span no time.
 */
export function dragVelocity(
  samples: readonly PointerSample[],
): CameraVelocity {
  const last = samples[samples.length - 1];
  if (!last) return { vx: 0, vy: 0 };
  let first = last;
  for (let i = samples.length - 2; i >= 0; i -= 1) {
    const sample = samples[i];
    if (!sample || last.t - sample.t > CAMERA_MOTION.velocityWindowMs) break;
    first = sample;
  }
  const seconds = (last.t - first.t) / 1000;
  if (seconds <= 0) return { vx: 0, vy: 0 };
  return { vx: (last.x - first.x) / seconds, vy: (last.y - first.y) / seconds };
}

/**
 * One frame of momentum panning: the camera advances by the current velocity
 * and the velocity decays by the friction constant, scaled to the elapsed
 * time so the feel does not depend on display refresh rate. A glide that
 * decays below the stop speed comes back with a zeroed velocity.
 */
export function stepMomentum(
  camera: Camera,
  velocity: CameraVelocity,
  dtMs: number,
): { camera: Camera; velocity: CameraVelocity } {
  const seconds = dtMs / 1000;
  const next: Camera = {
    ...camera,
    x: camera.x + velocity.vx * seconds,
    y: camera.y + velocity.vy * seconds,
  };
  const damping = Math.pow(
    CAMERA_MOTION.frictionPerFrame,
    dtMs / CAMERA_MOTION.referenceFrameMs,
  );
  const decayed = { vx: velocity.vx * damping, vy: velocity.vy * damping };
  if (glideStopped(decayed)) {
    return { camera: next, velocity: { vx: 0, vy: 0 } };
  }
  return { camera: next, velocity: decayed };
}

/** Linear interpolation between two cameras; zoom stays inside its limits. */
export function lerpCamera(from: Camera, to: Camera, t: number): Camera {
  const clamped = Math.min(1, Math.max(0, t));
  return {
    x: from.x + (to.x - from.x) * clamped,
    y: from.y + (to.y - from.y) * clamped,
    k: clampZoom(from.k + (to.k - from.k) * clamped),
  };
}

/** Cubic ease-out for the focus animation: quick departure, gentle landing. */
export function easeOutCubic(t: number): number {
  const u = 1 - Math.min(1, Math.max(0, t));
  return 1 - u * u * u;
}

/** Share of the remaining distance a smooth zoom covers in `dtMs`. */
export function zoomEase(dtMs: number): number {
  return (
    1 -
    Math.pow(
      1 - CAMERA_MOTION.zoomEasePerFrame,
      dtMs / CAMERA_MOTION.referenceFrameMs,
    )
  );
}

/** The camera origin a drag started from, which its pointer deltas add to. */
export interface DragOrigin {
  camX: number;
  camY: number;
}

/**
 * Where a live drag's origin moves when something other than the drag shifts
 * the camera (a zoom step, a fit). A drag positions the camera absolutely, as
 * origin plus the total pointer delta, so without this the next pointer move
 * would write the shift back out.
 */
export function rebaseDragOrigin(
  origin: DragOrigin,
  from: Camera,
  to: Camera,
): DragOrigin {
  return {
    camX: origin.camX + (to.x - from.x),
    camY: origin.camY + (to.y - from.y),
  };
}

/** Whether a smooth zoom is close enough to its target to snap to it. */
export function zoomSettled(current: Camera, target: Camera): boolean {
  return (
    Math.abs(current.k - target.k) < CAMERA_MOTION.zoomSnapK &&
    Math.abs(current.x - target.x) < CAMERA_MOTION.zoomSnapPx &&
    Math.abs(current.y - target.y) < CAMERA_MOTION.zoomSnapPx
  );
}
