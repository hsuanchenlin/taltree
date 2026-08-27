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
