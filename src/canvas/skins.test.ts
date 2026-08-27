import { Graphics, Polygon } from "pixi.js";
import { describe, expect, it } from "vitest";
import { drawBlocked, SKIN_ART_CENTER, SKIN_FRAME_RADIUS } from "./skins";

/**
 * Every polygon vertex the skin draws. Circles and rounded rects are stored as
 * their own primitives and cannot carry a stray connector, so the polygons are
 * the whole risk surface.
 *
 * Only the blocked skin is covered here: it is the one that draws an `arc`, and
 * the other three fill radial gradients, which Pixi bakes through a DOM canvas
 * that the node test environment does not provide.
 */
function blockedPolygonVertices(): { x: number; y: number }[] {
  const g = new Graphics();
  drawBlocked(g);
  const vertices: { x: number; y: number }[] = [];
  for (const instruction of g.context.instructions) {
    if (instruction.action !== "fill" && instruction.action !== "stroke") continue;
    for (const { shape } of instruction.data.path.shapePath.shapePrimitives) {
      if (!(shape instanceof Polygon)) continue;
      for (let i = 0; i < shape.points.length; i += 2) {
        vertices.push({ x: shape.points[i], y: shape.points[i + 1] });
      }
    }
  }
  g.destroy();
  return vertices;
}

describe("blocked socket skin", () => {
  it("keeps every vertex inside the baked frame", () => {
    const vertices = blockedPolygonVertices();
    expect(vertices.length).toBeGreaterThan(0);
    const strays = vertices.filter(
      (p) =>
        Math.hypot(p.x - SKIN_ART_CENTER, p.y - SKIN_ART_CENTER) >
        SKIN_FRAME_RADIUS,
    );
    // A vertex outside the frame means a subpath was seeded somewhere the art
    // never goes: Pixi leaves the previous stroke's subpath open, so the lock
    // shackle arc trails a connector in from that point unless `beginPath`
    // starts a fresh one first.
    expect(strays).toEqual([]);
  });
});
