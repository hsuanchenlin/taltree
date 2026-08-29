import { describe, expect, it } from "vitest";
import type { Camera, LaidOutNode } from "../graph";
import {
  BLANK_PROBE_LIMIT,
  isBlankSample,
  socketProbePoints,
} from "./blankBoard";
import { socketCenter } from "./relicGeometry";

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

const IDENTITY: Camera = { x: 0, y: 0, k: 1 };
const BOARD = { width: 800, height: 600 };
const CLEAR = { r: 0x0c, g: 0x10, b: 0x16 };

/** One opaque RGBA pixel repeated, the shape `readPixels` hands back. */
function block(r: number, g: number, b: number, count = 4, alpha = 255): number[] {
  return Array.from({ length: count }, () => [r, g, b, alpha]).flat();
}

describe("socketProbePoints", () => {
  it("puts each socket where the camera maps it", () => {
    const node = makeNode();
    const [point] = socketProbePoints([node], { x: 30, y: -20, k: 2 }, BOARD);
    const center = socketCenter(node);
    expect(point).toEqual({ x: center.x * 2 + 30, y: center.y * 2 - 20 });
  });

  it("prefers the sockets nearest the middle of the board", () => {
    const nodes = [
      makeNode({ id: "far", x: 0, y: 0 }),
      makeNode({ id: "near", x: 300, y: 250 }),
    ];
    const points = socketProbePoints(nodes, IDENTITY, BOARD, 1);
    expect(points).toHaveLength(1);
    expect(points[0]!.x).toBe(socketCenter(nodes[1]!).x);
  });

  it("returns at most the requested number of points", () => {
    const nodes = Array.from({ length: 8 }, (_, i) =>
      makeNode({ id: `n${i}`, x: 100 + i * 40, y: 100 }),
    );
    expect(socketProbePoints(nodes, IDENTITY, BOARD)).toHaveLength(
      BLANK_PROBE_LIMIT,
    );
  });

  it("skips sockets that hang over the edge of the board", () => {
    // Its centre is on the board, but the sample block would straddle the rim.
    const node = makeNode({ x: -190, y: 100 });
    expect(socketProbePoints([node], IDENTITY, BOARD)).toEqual([]);
  });

  it("declines to probe when zoom shrinks the sockets below a safe sample", () => {
    expect(socketProbePoints([makeNode()], { x: 0, y: 0, k: 0.1 }, BOARD)).toEqual(
      [],
    );
  });

  it("declines to probe a board with no measured size", () => {
    expect(
      socketProbePoints([makeNode()], IDENTITY, { width: 0, height: 0 }),
    ).toEqual([]);
  });
});

describe("isBlankSample", () => {
  it("calls a block of nothing but the clear colour blank", () => {
    expect(isBlankSample(block(0x0c, 0x10, 0x16), CLEAR)).toBe(true);
  });

  it("allows a channel or two of slack for a colour-managed swap chain", () => {
    expect(isBlankSample(block(0x0e, 0x0d, 0x1a), CLEAR)).toBe(true);
  });

  it("is not blank once any pixel carries socket art", () => {
    const pixels = [...block(0x0c, 0x10, 0x16, 3), ...block(0x46, 0xc7, 0x8f, 1)];
    expect(isBlankSample(pixels, CLEAR)).toBe(false);
  });

  it("treats a fully transparent read as saying nothing, not as blank", () => {
    // A read that never reached the drawing buffer comes back as zeroes; it
    // must never be the reason a working slab is torn down.
    expect(isBlankSample(block(0, 0, 0, 4, 0), CLEAR)).toBe(false);
  });

  it("treats an empty read as saying nothing", () => {
    expect(isBlankSample([], CLEAR)).toBe(false);
  });
});
