import type { Camera, LaidOutEdge, LaidOutNode } from "../graph";

/**
 * Pure geometry and diffing for the Pixi relic-slab renderer.
 * This module must stay free of Pixi and DOM imports so it can be unit-tested
 * in Vitest's node environment. The imperative world in `world.ts` consumes it.
 */

export const SOCKET_RADIUS = 36;
export const SOCKET_TOP = 8;
export const PLAQUE_TOP = 88;
export const PLAQUE_WIDTH = 170;
export const PLAQUE_TEXT_INSET = 8;
export const PLAQUE_WRAP_WIDTH = PLAQUE_WIDTH - PLAQUE_TEXT_INSET * 2;
/** Socket center -> plaque top, in world units. `world.ts` places the plaque with this. */
export const PLAQUE_OFFSET_Y = PLAQUE_TOP - SOCKET_TOP - SOCKET_RADIUS;
/** At or above this zoom every node shows its full plaque; below it only highlighted nodes do. */
export const LOD_READABLE_K = 0.85;
/** Most a highlighted plaque may grow past its laid-out size at very low zoom. */
export const PLAQUE_MAX_SCALE = 2.5;

export const PLAQUE_PAD_TOP = 4;
export const PLAQUE_PAD_BOTTOM = 5;
export const PLAQUE_TITLE_GAP = 1;
export const PLAQUE_CAPTION_GAP = 3;
export const PLAQUE_TITLE_FONT_SIZE = 13;
export const PLAQUE_SUB_FONT_SIZE = 11;
export const PLAQUE_CAPTION_FONT_SIZE = 11;
const TITLE_LINE_HEIGHT = 17;
const SUB_LINE_HEIGHT = 15;
const CAPTION_LINE_HEIGHT = 15;
/**
 * Deliberately wider than any proportional glyph the plaque fonts draw at their
 * size, so the predicted line count is never below the one Pixi wraps to.
 * Full-width glyphs advance a whole em instead - see `isWideGlyph`.
 */
const TITLE_CHAR_WIDTH = 8;
const CAPTION_CHAR_WIDTH = 7;
/** Distance between two ranks in world units (`TREE_LAYOUT.nodeHeight + rankGap`). */
export const RANK_PITCH = 200;
/** A plaque at its laid-out size must never reach the rank below. */
const PLAQUE_MAX_HEIGHT = RANK_PITCH - PLAQUE_TOP;

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

const WIDE_GLYPH =
  /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏가-힣豈-﫿︐-︙︰-﹯＀-｠￠-￦]/;

/**
 * Whether a code point advances a full em rather than the proportional width a
 * Latin glyph takes: CJK and full-width forms, plus everything above the BMP
 * (emoji, CJK extensions), which is wide or close enough that reserving an em
 * keeps the estimate on the safe side.
 */
function isWideGlyph(glyph: string): boolean {
  const code = glyph.codePointAt(0);
  if (code === undefined) return false;
  return code > 0xffff || WIDE_GLYPH.test(glyph);
}

function textAdvance(text: string, charWidth: number, wideWidth: number): number {
  let total = 0;
  for (const glyph of text) total += isWideGlyph(glyph) ? wideWidth : charWidth;
  return total;
}

/**
 * How many wrapped lines a plaque string needs, never fewer than Pixi produces.
 * Mirrors Pixi's greedy word wrap with `breakWords`: whole words move to the
 * next line, and only a word too long for one line is broken inside.
 */
export function wrappedLineCount(
  text: string,
  charWidth: number,
  wideWidth: number,
): number {
  if (text.length === 0) return 0;
  let lines = 1;
  let used = 0;
  for (const word of text.split(/\s+/)) {
    if (word.length === 0) continue;
    const gap = used === 0 ? 0 : charWidth;
    const width = textAdvance(word, charWidth, wideWidth);
    if (used + gap + width <= PLAQUE_WRAP_WIDTH) {
      used += gap + width;
      continue;
    }
    if (used > 0) {
      lines += 1;
      used = 0;
    }
    if (width <= PLAQUE_WRAP_WIDTH) {
      used = width;
      continue;
    }
    for (const glyph of word) {
      const advance = isWideGlyph(glyph) ? wideWidth : charWidth;
      if (used + advance > PLAQUE_WRAP_WIDTH) {
        lines += 1;
        used = advance;
      } else {
        used += advance;
      }
    }
  }
  return lines;
}

/**
 * The plaque's height for a node, from the title, cost/kind line, and optional
 * caption it has to hold. This is the single source of truth: `world.ts` draws
 * the plaque background at exactly this height (eliding text that will not fit)
 * so the hit box and the visible plaque can never disagree.
 */
export function plaqueHeight(
  node: Pick<LaidOutNode, "title" | "caption">,
): number {
  const titleLines = Math.max(
    1,
    wrappedLineCount(node.title, TITLE_CHAR_WIDTH, PLAQUE_TITLE_FONT_SIZE),
  );
  const captionLines = node.caption
    ? wrappedLineCount(
        node.caption,
        CAPTION_CHAR_WIDTH,
        PLAQUE_CAPTION_FONT_SIZE,
      )
    : 0;
  const captionBlock =
    captionLines === 0 ? 0 : captionLines * CAPTION_LINE_HEIGHT + PLAQUE_CAPTION_GAP;
  return Math.min(
    PLAQUE_MAX_HEIGHT,
    PLAQUE_PAD_TOP +
      titleLines * TITLE_LINE_HEIGHT +
      PLAQUE_TITLE_GAP +
      SUB_LINE_HEIGHT +
      captionBlock +
      PLAQUE_PAD_BOTTOM,
  );
}

export function plaqueBox(
  node: Pick<LaidOutNode, "x" | "y" | "width" | "title" | "caption">,
): Rect {
  return {
    x: node.x + node.width / 2 - PLAQUE_WIDTH / 2,
    y: node.y + PLAQUE_TOP,
    width: PLAQUE_WIDTH,
    height: plaqueHeight(node),
  };
}

/**
 * Counter-scale a plaque keeps so highlighted plaques (selected, hovered,
 * unlocks-next) stay readable below the LOD threshold instead of shrinking
 * with the world. At or above `LOD_READABLE_K` plaques render 1:1; below it the
 * counter-scale is capped - by `PLAQUE_MAX_SCALE` so a plaque at minimum zoom
 * cannot swamp the board, and by the rank pitch so a tall plaque cannot grow
 * across the ranks beneath it.
 */
export function plaqueScale(
  node: Pick<LaidOutNode, "title" | "caption">,
  cameraK: number,
): number {
  if (cameraK >= LOD_READABLE_K) return 1;
  const zoomScale = Math.min(
    PLAQUE_MAX_SCALE,
    LOD_READABLE_K / Math.max(cameraK, 0.01),
  );
  // A tall plaque grown by the zoom cap would span several ranks of the board,
  // so its scaled height is also capped at one rank pitch.
  const heightScale = RANK_PITCH / plaqueHeight(node);
  return Math.max(1, Math.min(zoomScale, heightScale));
}

/**
 * The plaque box as actually rendered at a given zoom: `plaqueBox` grown by
 * `plaqueScale` around the plaque's anchor (top center, under the socket).
 * `world.ts` scales the plaque container by the same factor, and the hit test
 * uses this box, so what is drawn and what is clickable never disagree.
 */
export function plaqueHitBox(
  node: Pick<LaidOutNode, "x" | "y" | "width" | "title" | "caption">,
  cameraK: number,
): Rect {
  const box = plaqueBox(node);
  const scale = plaqueScale(node, cameraK);
  if (scale === 1) return box;
  const anchorX = node.x + node.width / 2;
  return {
    x: anchorX + (box.x - anchorX) * scale,
    y: box.y,
    width: box.width * scale,
    height: box.height * scale,
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
      const box = plaqueHitBox(node, camera.k);
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
