import type { Camera, LaidOutEdge, LaidOutNode } from "../graph";

/**
 * Pure geometry and diffing for the Pixi relic-slab renderer.
 * This module must stay free of Pixi and DOM imports so it can be unit-tested
 * in Vitest's node environment. The imperative world in `world.ts` consumes it.
 */

export const SOCKET_RADIUS = 36;
export const SOCKET_TOP = 8;
export const PLAQUE_TOP = 88;
export const PLAQUE_HEIGHT = 34;
export const PLAQUE_SIDE_INSET = 15;
/** At or above this zoom every node shows its full plaque; below it only highlighted nodes do. */
export const LOD_READABLE_K = 0.85;

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function socketCenter(node: Pick<LaidOutNode, "x" | "y" | "width">): Point {
  return {
    x: node.x + node.width / 2,
    y: node.y + SOCKET_TOP + SOCKET_RADIUS,
  };
}

export function plaqueBox(node: Pick<LaidOutNode, "x" | "y" | "width">): Rect {
  return {
    x: node.x + PLAQUE_SIDE_INSET,
    y: node.y + PLAQUE_TOP,
    width: node.width - PLAQUE_SIDE_INSET * 2,
    height: PLAQUE_HEIGHT,
  };
}

export function plaqueVisible(
  node: Pick<LaidOutNode, "id" | "selected" | "unlocksIfCompleted">,
  cameraK: number,
  hoveredId: string | null = null,
): boolean {
  if (cameraK >= LOD_READABLE_K) return true;
  return node.selected || node.unlocksIfCompleted || node.id === hoveredId;
}

/**
 * Screen-space hit test against the laid-out boxes we already have, per the
 * relic-slab design: the socket circle (radius scaled by zoom) or, when the
 * plaque is showing, the plaque box. Returns the topmost hit (later nodes win).
 */
export function hitTestNode(
  nodes: readonly LaidOutNode[],
  point: Point,
  camera: Camera,
  hoveredId: string | null = null,
): LaidOutNode | null {
  for (let i = nodes.length - 1; i >= 0; i -= 1) {
    const node = nodes[i];
    if (!node) continue;
    const center = socketCenter(node);
    const sx = camera.x + center.x * camera.k;
    const sy = camera.y + center.y * camera.k;
    const radius = SOCKET_RADIUS * camera.k;
    const dx = point.x - sx;
    const dy = point.y - sy;
    if (dx * dx + dy * dy <= radius * radius) return node;
    if (plaqueVisible(node, camera.k, hoveredId)) {
      const box = plaqueBox(node);
      if (
        point.x >= camera.x + box.x * camera.k &&
        point.x <= camera.x + (box.x + box.width) * camera.k &&
        point.y >= camera.y + box.y * camera.k &&
        point.y <= camera.y + (box.y + box.height) * camera.k
      ) {
        return node;
      }
    }
  }
  return null;
}

/** Everything about a node the relic world draws, in one comparable signature. */
export function visualSignature(node: LaidOutNode): string {
  return [
    node.kind,
    node.selected ? 1 : 0,
    node.unlocksIfCompleted ? 1 : 0,
    node.exceedsBudget ? 1 : 0,
    node.x,
    node.y,
    node.title,
    node.cost,
    node.caption ?? "",
    node.captionTone ?? "",
  ].join("|");
}

export interface WorldDiff {
  added: LaidOutNode[];
  removed: string[];
  updated: LaidOutNode[];
}

export function diffWorldNodes(
  previous: readonly LaidOutNode[],
  next: readonly LaidOutNode[],
): WorldDiff {
  const prevById = new Map(previous.map((node) => [node.id, node]));
  const nextIds = new Set(next.map((node) => node.id));
  const added: LaidOutNode[] = [];
  const updated: LaidOutNode[] = [];
  for (const node of next) {
    const before = prevById.get(node.id);
    if (!before) added.push(node);
    else if (visualSignature(before) !== visualSignature(node)) updated.push(node);
  }
  const removed = previous
    .map((node) => node.id)
    .filter((id) => !nextIds.has(id));
  return { added, removed, updated };
}

export interface EdgeCurve {
  from: Point;
  c1: Point;
  c2: Point;
  to: Point;
}

/** The same cubic the SVG renderer draws in `layout.placeEdge`. */
export function edgeCurve(
  edge: Pick<LaidOutEdge, "x1" | "y1" | "x2" | "y2">,
): EdgeCurve {
  const midY = Math.round((edge.y1 + edge.y2) / 2);
  return {
    from: { x: edge.x1, y: edge.y1 },
    c1: { x: edge.x1, y: midY },
    c2: { x: edge.x2, y: midY },
    to: { x: edge.x2, y: edge.y2 },
  };
}

export function cubicPoint(curve: EdgeCurve, t: number): Point {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * curve.from.x + b * curve.c1.x + c * curve.c2.x + d * curve.to.x,
    y: a * curve.from.y + b * curve.c1.y + c * curve.c2.y + d * curve.to.y,
  };
}

export function cubicTangent(curve: EdgeCurve, t: number): Point {
  const u = 1 - t;
  const x =
    3 * u * u * (curve.c1.x - curve.from.x) +
    6 * u * t * (curve.c2.x - curve.c1.x) +
    3 * t * t * (curve.to.x - curve.c2.x);
  const y =
    3 * u * u * (curve.c1.y - curve.from.y) +
    6 * u * t * (curve.c2.y - curve.c1.y) +
    3 * t * t * (curve.to.y - curve.c2.y);
  const length = Math.hypot(x, y) || 1;
  return { x: x / length, y: y / length };
}

/**
 * Splits the edge curve into dash polylines for the empty-groove look.
 * Pixi has no dashed stroke, so `world.ts` strokes each polyline separately.
 */
export function dashPath(
  edge: Pick<LaidOutEdge, "x1" | "y1" | "x2" | "y2">,
  dashLength = 7,
  gapLength = 6,
): Point[][] {
  const curve = edgeCurve(edge);
  const steps = 96;
  const samples: Point[] = [];
  for (let i = 0; i <= steps; i += 1) samples.push(cubicPoint(curve, i / steps));

  const dashes: Point[][] = [];
  let current: Point[] = [];
  let drawing = true;
  let budget = dashLength;
  for (let i = 1; i < samples.length; i += 1) {
    const a = samples[i - 1];
    const b = samples[i];
    if (!a || !b) continue;
    let remaining = Math.hypot(b.x - a.x, b.y - a.y);
    let cursor = a;
    while (remaining > 0) {
      const take = Math.min(remaining, budget);
      const next = {
        x: cursor.x + ((b.x - cursor.x) * take) / remaining,
        y: cursor.y + ((b.y - cursor.y) * take) / remaining,
      };
      if (drawing) {
        if (current.length === 0) current.push(cursor);
        current.push(next);
      }
      budget -= take;
      if (budget <= 0) {
        if (drawing && current.length > 1) dashes.push(current);
        if (drawing) current = [];
        drawing = !drawing;
        budget = drawing ? dashLength : gapLength;
      }
      cursor = next;
      remaining -= take;
    }
  }
  if (current.length > 1) dashes.push(current);
  return dashes;
}
