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
  plaqueHeight,
  PLAQUE_TOP,
  PLAQUE_WIDTH,
  PLAQUE_WRAP_WIDTH,
  plaqueVisible,
  socketCenter,
  SOCKET_RADIUS,
  visualSignature,
  wrappedLineCount,
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

describe("plaqueBox", () => {
  it("centers the drawn plaque width under the socket", () => {
    const box = plaqueBox(makeNode());
    expect(box.width).toBe(PLAQUE_WIDTH);
    expect(box.x + box.width / 2).toBe(100 + 200 / 2);
    expect(box.y).toBe(50 + PLAQUE_TOP);
  });

  it("grows with wrapped titles and captions, as the drawn plaque does", () => {
    const short = plaqueHeight(makeNode());
    const captioned = plaqueHeight(makeNode({ caption: "Waiting on Draft" }));
    const wrapped = plaqueHeight(
      makeNode({ title: "A considerably longer talent title that wraps" }),
    );
    expect(captioned).toBeGreaterThan(short);
    expect(wrapped).toBeGreaterThan(short);
    expect(
      plaqueHeight(
        makeNode({
          title: "A considerably longer talent title that wraps",
          caption: "Waiting on Draft",
        }),
      ),
    ).toBeGreaterThan(Math.max(captioned, wrapped));
  });

  it("reserves the extra lines a full-width title really wraps to", () => {
    const latin = plaqueHeight(makeNode({ title: "x".repeat(14) }));
    const cjk = plaqueHeight(makeNode({ title: "字".repeat(14) }));
    expect(latin).toBe(plaqueHeight(makeNode()));
    expect(cjk).toBeGreaterThan(latin);
    expect(
      plaqueHeight(makeNode({ caption: "等待「字字字字字字字字字字字字字字」" })),
    ).toBeGreaterThan(plaqueHeight(makeNode({ caption: "Waiting on Draft" })));
  });

  it("covers the plaque heights world.ts draws for realistic content", () => {
    // world.ts stacks 4px padding, a 13px title, a 11px cost/kind line, an
    // optional 11px caption, and 5px padding. These are the drawn extents.
    expect(plaqueHeight(makeNode())).toBeGreaterThanOrEqual(41);
    expect(
      plaqueHeight(makeNode({ caption: "Waiting on Draft" })),
    ).toBeGreaterThanOrEqual(57);
  });

  it("never reaches the rank below, even for a pathological title", () => {
    const height = plaqueHeight(makeNode({ title: "x".repeat(200) }));
    expect(PLAQUE_TOP + height).toBeLessThanOrEqual(200);
  });
});

describe("wrappedLineCount", () => {
  it("is zero for empty text and one for text that fits", () => {
    expect(wrappedLineCount("", 8, 13)).toBe(0);
    expect(wrappedLineCount("Draft", 8, 13)).toBe(1);
  });

  it("counts one line per wrap width", () => {
    const perLine = Math.floor(PLAQUE_WRAP_WIDTH / 8);
    expect(wrappedLineCount("x".repeat(perLine), 8, 13)).toBe(1);
    expect(wrappedLineCount("x".repeat(perLine + 1), 8, 13)).toBe(2);
  });

  it("keeps whole words together and only breaks a word too long for a line", () => {
    // Six 24px words plus five 8px gaps is 184px: the last word moves down.
    expect(wrappedLineCount("abc abc abc abc abc abc", 8, 13)).toBe(2);
    expect(wrappedLineCount("x".repeat(40), 8, 13)).toBe(3);
  });

  it("advances a full em per full-width glyph, as Pixi does", () => {
    // 154 / 13 fits 11 ideographs a line, so 14 need two and 23 need three.
    expect(wrappedLineCount("字".repeat(11), 8, 13)).toBe(1);
    expect(wrappedLineCount("字".repeat(14), 8, 13)).toBe(2);
    expect(wrappedLineCount("字".repeat(23), 8, 13)).toBe(3);
    // Kana, Hangul, full-width forms, and astral emoji count the same.
    expect(wrappedLineCount("あ".repeat(14), 8, 13)).toBe(2);
    expect(wrappedLineCount("한".repeat(14), 8, 13)).toBe(2);
    expect(wrappedLineCount("Ａ".repeat(14), 8, 13)).toBe(2);
    expect(wrappedLineCount("🙂".repeat(14), 8, 13)).toBe(2);
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

  it("hits the bottom of a captioned plaque, which is taller than a bare one", () => {
    const node = makeNode({ caption: "Waiting on Draft", captionTone: "blocked" });
    const box = plaqueBox(node);
    const hit = hitTestNode(
      [node],
      {
        x: camera.x + box.x + box.width / 2,
        y: camera.y + box.y + box.height - 1,
      },
      camera,
    );
    expect(hit?.id).toBe("a");
    expect(box.height).toBeGreaterThan(plaqueBox(makeNode()).height);
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
