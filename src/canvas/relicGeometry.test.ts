import { describe, expect, it } from "vitest";
import type { LaidOutEdge, LaidOutNode } from "../graph";
import {
  cubicPoint,
  dashPath,
  diffWorldNodes,
  edgeCurve,
  hitTestNode,
  LOD_READABLE_K,
  plaqueBox,
  plaqueVisible,
  socketCenter,
  SOCKET_RADIUS,
  visualSignature,
} from "./relicGeometry";

function makeNode(overrides: Partial<LaidOutNode> = {}): LaidOutNode {
  return {
    id: "a",
    title: "Node A",
    cost: 2,
    kind: "eligible",
    originalIndex: 0,
    exceedsBudget: false,
    waitingOn: [],
    selected: false,
    unlocksIfCompleted: false,
    caption: null,
    captionTone: null,
    x: 100,
    y: 50,
    width: 200,
    height: 124,
    ...overrides,
  };
}

describe("socketCenter", () => {
  it("centers the 72px socket horizontally in the laid-out box, near its top", () => {
    const center = socketCenter(makeNode());
    expect(center.x).toBe(200);
    expect(center.y).toBe(50 + 8 + SOCKET_RADIUS);
  });
});

describe("plaqueVisible (LOD)", () => {
  it("shows every plaque at readable zoom", () => {
    expect(plaqueVisible(makeNode(), LOD_READABLE_K)).toBe(true);
    expect(plaqueVisible(makeNode(), 1.4)).toBe(true);
  });

  it("hides plain plaques when zoomed out, keeping selected/unlocks/hovered", () => {
    const k = 0.5;
    expect(plaqueVisible(makeNode(), k)).toBe(false);
    expect(plaqueVisible(makeNode({ selected: true }), k)).toBe(true);
    expect(plaqueVisible(makeNode({ unlocksIfCompleted: true }), k)).toBe(true);
    expect(plaqueVisible(makeNode({ id: "b" }), k, "b")).toBe(true);
  });
});

describe("hitTestNode", () => {
  const camera = { x: 10, y: 20, k: 1 };

  it("hits the socket circle in screen space", () => {
    const node = makeNode();
    const center = socketCenter(node);
    const hit = hitTestNode(
      [node],
      { x: camera.x + center.x, y: camera.y + center.y },
      camera,
    );
    expect(hit?.id).toBe("a");
  });

  it("misses outside the socket and invisible plaque", () => {
    const node = makeNode();
    expect(hitTestNode([node], { x: 0, y: 0 }, camera)).toBeNull();
    // A point inside the plaque box does not hit while the plaque is LOD-hidden.
    const box = plaqueBox(node);
    const lowZoom = { x: 0, y: 0, k: 0.5 };
    expect(
      hitTestNode(
        [node],
        {
          x: (box.x + box.width / 2) * 0.5,
          y: (box.y + box.height / 2) * 0.5,
        },
        lowZoom,
      ),
    ).toBeNull();
  });

  it("hits the plaque box of a selected node even when zoomed out", () => {
    const node = makeNode({ selected: true });
    const box = plaqueBox(node);
    const lowZoom = { x: 0, y: 0, k: 0.5 };
    const hit = hitTestNode(
      [node],
      {
        x: (box.x + box.width / 2) * 0.5,
        y: (box.y + box.height / 2) * 0.5,
      },
      lowZoom,
    );
    expect(hit?.id).toBe("a");
  });

  it("scales the socket radius with zoom and prefers later nodes", () => {
    const a = makeNode({ id: "a" });
    const b = makeNode({ id: "b" });
    const k = 2;
    const cam = { x: 0, y: 0, k };
    const center = socketCenter(a);
    const edge = {
      x: (center.x + SOCKET_RADIUS - 1) * k,
      y: center.y * k,
    };
    const hit = hitTestNode([a, b], edge, cam);
    expect(hit?.id).toBe("b");
  });
});

describe("diffWorldNodes", () => {
  it("reports added, removed, and visually changed nodes by id", () => {
    const prev = [makeNode({ id: "a" }), makeNode({ id: "b", x: 400 })];
    const next = [
      makeNode({ id: "a", kind: "completed" }),
      makeNode({ id: "c", x: 700 }),
    ];
    const diff = diffWorldNodes(prev, next);
    expect(diff.added.map((n) => n.id)).toEqual(["c"]);
    expect(diff.removed).toEqual(["b"]);
    expect(diff.updated.map((n) => n.id)).toEqual(["a"]);
  });

  it("treats identical trees as a no-op", () => {
    const nodes = [makeNode({ id: "a" }), makeNode({ id: "b", x: 400 })];
    const diff = diffWorldNodes(nodes, nodes.map((n) => ({ ...n })));
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.updated).toEqual([]);
  });

  it("includes captions and selection in the visual signature", () => {
    const node = makeNode();
    expect(visualSignature(node)).not.toBe(
      visualSignature({ ...node, caption: "Waiting on X" }),
    );
    expect(visualSignature(node)).not.toBe(
      visualSignature({ ...node, selected: true }),
    );
  });
});

describe("edge curves and dashes", () => {
  const edge: Pick<LaidOutEdge, "x1" | "y1" | "x2" | "y2"> = {
    x1: 100,
    y1: 200,
    x2: 340,
    y2: 400,
  };

  it("edgeCurve matches the SVG path control points from layout.placeEdge", () => {
    const curve = edgeCurve(edge);
    expect(curve.from).toEqual({ x: 100, y: 200 });
    expect(curve.to).toEqual({ x: 340, y: 400 });
    expect(curve.c1).toEqual({ x: 100, y: 300 });
    expect(curve.c2).toEqual({ x: 340, y: 300 });
    expect(cubicPoint(curve, 0)).toEqual(curve.from);
    const end = cubicPoint(curve, 1);
    expect(end.x).toBeCloseTo(340);
    expect(end.y).toBeCloseTo(400);
  });

  it("dashPath emits separated polylines along the curve", () => {
    const dashes = dashPath(edge);
    expect(dashes.length).toBeGreaterThan(3);
    for (const dash of dashes) {
      expect(dash.length).toBeGreaterThan(1);
      for (const point of dash) {
        expect(point.x).toBeGreaterThanOrEqual(99);
        expect(point.x).toBeLessThanOrEqual(341);
        expect(point.y).toBeGreaterThanOrEqual(199);
        expect(point.y).toBeLessThanOrEqual(401);
      }
    }
    // Consecutive dashes are separated by a visible gap.
    for (let i = 1; i < dashes.length; i += 1) {
      const prevEnd = dashes[i - 1]?.at(-1);
      const nextStart = dashes[i]?.[0];
      expect(prevEnd && nextStart).toBeTruthy();
      const gap = Math.hypot(
        (nextStart?.x ?? 0) - (prevEnd?.x ?? 0),
        (nextStart?.y ?? 0) - (prevEnd?.y ?? 0),
      );
      expect(gap).toBeGreaterThan(2);
    }
  });
});
