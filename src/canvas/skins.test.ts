import { FillGradient, Graphics, Polygon } from "pixi.js";
import { describe, expect, it } from "vitest";
import {
  drawBlocked,
  drawCompleted,
  drawDeferred,
  drawEligible,
  SKIN_ART_CENTER,
  SKIN_FRAME_RADIUS,
} from "./skins";

/**
 * The skins draw into a plain `Graphics` with no renderer and no DOM canvas, so
 * what they put in the context can be asserted on directly. That covers all
 * four only because the sockets fill radial gradients by stacking flat circles:
 * a `FillGradient` bakes through a DOM canvas the node environment has none of.
 */

const SKINS = {
  blocked: drawBlocked,
  eligible: drawEligible,
  completed: drawCompleted,
  deferred: drawDeferred,
} as const;

function contextOf(draw: (g: Graphics) => void): Graphics {
  const g = new Graphics();
  draw(g);
  return g;
}

/**
 * Every polygon vertex the skin draws. Circles and rounded rects are stored as
 * their own primitives and cannot carry a stray connector, so the polygons are
 * the whole risk surface.
 */
function polygonVertices(g: Graphics): { x: number; y: number }[] {
  const vertices: { x: number; y: number }[] = [];
  for (const instruction of g.context.instructions) {
    if (instruction.action !== "fill" && instruction.action !== "stroke") continue;
    for (const { shape } of instruction.data.path.shapePath.shapePrimitives) {
      if (!(shape instanceof Polygon)) continue;
      for (let i = 0; i < shape.points.length; i += 2) {
        vertices.push({ x: shape.points[i]!, y: shape.points[i + 1]! });
      }
    }
  }
  return vertices;
}

/**
 * A gradient survives conversion as the `fill` of the converted style, so it is
 * still recognisable once Pixi has turned it into one.
 */
function isGradient(style: unknown): boolean {
  if (style instanceof FillGradient) return true;
  if (typeof style !== "object" || style === null) return false;
  return (style as { fill?: unknown }).fill instanceof FillGradient;
}

describe.each(Object.entries(SKINS))("the %s socket skin", (_name, draw) => {
  it("draws something to bake", () => {
    const g = contextOf(draw);
    expect(g.context.instructions.length).toBeGreaterThan(0);
    g.destroy();
  });

  it("keeps every vertex inside the baked frame", () => {
    const g = contextOf(draw);
    const strays = polygonVertices(g).filter(
      (p) =>
        Math.hypot(p.x - SKIN_ART_CENTER, p.y - SKIN_ART_CENTER) >
        SKIN_FRAME_RADIUS,
    );
    // A vertex outside the frame means a subpath was seeded somewhere the art
    // never goes: Pixi leaves the previous stroke's subpath open, so the lock
    // shackle arc trails a connector in from that point unless `beginPath`
    // starts a fresh one first.
    expect(strays).toEqual([]);
    g.destroy();
  });

  it("bakes without a gradient, so no DOM canvas stands between art and texture", () => {
    const g = contextOf(draw);
    const styles: unknown[] = g.context.instructions
      .filter((instruction) => instruction.action === "fill")
      .map((instruction) => instruction.data.style);
    expect(styles.length).toBeGreaterThan(0);
    expect(styles.filter(isGradient)).toEqual([]);
    g.destroy();
  });
});

describe("the blocked socket skin", () => {
  it("has a polygon to guard: it is the one skin that draws an arc", () => {
    const g = contextOf(drawBlocked);
    expect(polygonVertices(g).length).toBeGreaterThan(0);
    g.destroy();
  });
});
