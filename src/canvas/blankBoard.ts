import type { Camera, LaidOutNode } from "../graph";
import { SOCKET_RADIUS, socketCenter } from "./relicGeometry";

/**
 * Deciding whether the slab actually painted anything.
 *
 * Every failure the renderer can *report* already degrades to the classic tree
 * through the error boundary. The failure that hurts is the silent one: Pixi
 * initialises, the ticker runs, frames are counted, and the board shows nothing
 * but its clear colour. Nothing throws, so nothing falls back, and the person
 * gets a black rectangle. This module supplies the two pure halves of catching
 * that - where on the board a socket must be painted, and whether a block of
 * pixels read back from there is nothing but the clear colour.
 *
 * Pixi- and DOM-free, so it carries its own unit tests; `TalentTreePixi` does
 * the reading.
 */

export interface ProbePoint {
  /** Board-space CSS pixels, measured from the top-left of the canvas. */
  x: number;
  y: number;
}

export interface BoardSize {
  width: number;
  height: number;
}

/** Probe points to sample. More than one so a single stray sprite cannot pass. */
export const BLANK_PROBE_LIMIT = 3;

/**
 * Smallest on-screen socket radius worth probing, in CSS pixels. Below this the
 * socket is too small for a sample block to sit safely inside its art, and a
 * miss would read the board behind it and look exactly like a blank slab.
 */
const MIN_PROBE_RADIUS = 8;

/** Fraction of the socket radius a probe point must stay clear of the rim by. */
const PROBE_INSET = 0.5;

/**
 * Where a working board must have painted socket art, most central first.
 *
 * A point qualifies only when its socket is large enough to sample and sits
 * fully inside the board, so an empty list means "nothing to conclude from"
 * rather than "the board is blank".
 */
export function socketProbePoints(
  nodes: readonly LaidOutNode[],
  camera: Camera,
  board: BoardSize,
  limit: number = BLANK_PROBE_LIMIT,
): ProbePoint[] {
  if (board.width <= 0 || board.height <= 0) return [];
  const radius = SOCKET_RADIUS * camera.k;
  if (radius < MIN_PROBE_RADIUS) return [];
  const margin = radius * PROBE_INSET;
  const center = { x: board.width / 2, y: board.height / 2 };
  return nodes
    .map((node) => {
      const world = socketCenter(node);
      return {
        x: world.x * camera.k + camera.x,
        y: world.y * camera.k + camera.y,
      };
    })
    .filter(
      (point) =>
        point.x - margin >= 0 &&
        point.y - margin >= 0 &&
        point.x + margin <= board.width &&
        point.y + margin <= board.height,
    )
    .sort(
      (a, b) =>
        Math.hypot(a.x - center.x, a.y - center.y) -
        Math.hypot(b.x - center.x, b.y - center.y),
    )
    .slice(0, Math.max(0, limit));
}

export interface ClearColor {
  r: number;
  g: number;
  b: number;
}

/** Per-channel slack, so dithering or a colour-managed swap chain still counts. */
const CLEAR_TOLERANCE = 8;

/**
 * Whether an RGBA block read back from the board is nothing but its clear
 * colour.
 *
 * Deliberately one-sided: every uncertain answer is `false`. An empty read, or
 * a fully transparent one - which is what a read that never reached the drawing
 * buffer looks like - says nothing about what the board shows, and must never
 * be the reason a working slab is torn down.
 */
export function isBlankSample(
  pixels: ArrayLike<number>,
  clear: ClearColor,
  tolerance: number = CLEAR_TOLERANCE,
): boolean {
  if (pixels.length < 4) return false;
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    if (pixels[i + 3] === 0) return false;
    if (
      Math.abs(pixels[i]! - clear.r) > tolerance ||
      Math.abs(pixels[i + 1]! - clear.g) > tolerance ||
      Math.abs(pixels[i + 2]! - clear.b) > tolerance
    ) {
      return false;
    }
  }
  return true;
}
