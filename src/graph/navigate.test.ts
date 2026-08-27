import { describe, expect, it } from "vitest";
import { nearestNode } from "./navigate";

const nodes = [
  box("a", 0, 0),
  box("b", 200, 0),
  box("c", 0, 160),
  box("d", 200, 160),
];

describe("nearestNode", () => {
  it("moves to the neighbor in the requested direction", () => {
    expect(nearestNode(nodes, "a", "right")).toBe("b");
    expect(nearestNode(nodes, "a", "down")).toBe("c");
    expect(nearestNode(nodes, "d", "left")).toBe("c");
    expect(nearestNode(nodes, "d", "up")).toBe("b");
  });

  it("returns null when nothing lies in that direction", () => {
    expect(nearestNode(nodes, "a", "left")).toBeNull();
    expect(nearestNode(nodes, "a", "up")).toBeNull();
  });

  it("selects the first node when the current id is missing", () => {
    expect(nearestNode(nodes, "missing", "right")).toBe("a");
    expect(nearestNode([], "a", "right")).toBeNull();
  });
});

function box(id: string, x: number, y: number) {
  return { id, x, y, width: 176, height: 96 };
}
