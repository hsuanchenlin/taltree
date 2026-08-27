import { describe, expect, it } from "vitest";
import {
  CAMERA_LIMITS,
  clampZoom,
  ensureVisible,
  fitCamera,
  zoomAbout,
} from "./camera";
import type { Camera } from "./camera";

const VIEWPORT = { width: 800, height: 600 };

function box(x: number, y: number) {
  return { x, y, width: 200, height: 124 };
}

describe("camera zoom", () => {
  it("clamps to the readable zoom range", () => {
    expect(clampZoom(0.01)).toBe(CAMERA_LIMITS.minZoom);
    expect(clampZoom(99)).toBe(CAMERA_LIMITS.maxZoom);
    expect(clampZoom(1.4)).toBe(1.4);
  });

  it("keeps the world point under the zoom focus fixed", () => {
    const camera: Camera = { x: 37, y: -22, k: 0.8 };
    const focus = { x: 310, y: 180 };
    const worldBefore = {
      x: (focus.x - camera.x) / camera.k,
      y: (focus.y - camera.y) / camera.k,
    };
    const zoomed = zoomAbout(camera, 1.15, focus);
    const worldAfter = {
      x: (focus.x - zoomed.x) / zoomed.k,
      y: (focus.y - zoomed.y) / zoomed.k,
    };

    expect(zoomed.k).toBeCloseTo(0.92, 10);
    expect(worldAfter.x).toBeCloseTo(worldBefore.x, 10);
    expect(worldAfter.y).toBeCloseTo(worldBefore.y, 10);
  });

  it("stops zooming at the limits while keeping the focus fixed", () => {
    const atMax = zoomAbout({ x: 0, y: 0, k: CAMERA_LIMITS.maxZoom }, 4, {
      x: 100,
      y: 100,
    });
    expect(atMax.k).toBe(CAMERA_LIMITS.maxZoom);
    expect(atMax.x).toBeCloseTo(0, 10);
    expect(atMax.y).toBeCloseTo(0, 10);

    const atMin = zoomAbout({ x: 0, y: 0, k: CAMERA_LIMITS.minZoom }, 0.1, {
      x: 100,
      y: 100,
    });
    expect(atMin.k).toBe(CAMERA_LIMITS.minZoom);
  });
});

describe("fitCamera", () => {
  it("centres a small tree without magnifying past natural size", () => {
    const camera = fitCamera({ width: 400, height: 300 }, VIEWPORT);
    expect(camera.k).toBe(1);
    expect(camera.x).toBe((VIEWPORT.width - 400) / 2);
    expect(camera.y).toBe((VIEWPORT.height - 300) / 2);
  });

  it("shrinks a wide tree to fit inside the padded viewport", () => {
    const tree = { width: 2000, height: 300 };
    const camera = fitCamera(tree, VIEWPORT);
    const pad = CAMERA_LIMITS.fitPadding;
    expect(camera.k).toBeCloseTo((VIEWPORT.width - pad * 2) / tree.width, 10);
    expect(camera.x).toBeCloseTo((VIEWPORT.width - tree.width * camera.k) / 2, 10);
  });

  it("never zooms out past the minimum, even for an enormous tree", () => {
    const camera = fitCamera({ width: 100000, height: 100000 }, VIEWPORT);
    expect(camera.k).toBe(CAMERA_LIMITS.minZoom);
  });

  it("returns an identity camera when the viewport has not been measured", () => {
    expect(fitCamera({ width: 900, height: 400 }, { width: 0, height: 0 })).toEqual({
      x: 0,
      y: 0,
      k: 1,
    });
  });
});

describe("ensureVisible", () => {
  const camera: Camera = { x: 0, y: 0, k: 1 };

  it("leaves an already visible node alone, preserving the camera identity", () => {
    const same = ensureVisible(box(300, 200), camera, VIEWPORT);
    expect(same).toBe(camera);
  });

  it("pans a node past the left or top edge back to the margin", () => {
    const moved = ensureVisible(box(-140, -60), camera, VIEWPORT);
    const margin = CAMERA_LIMITS.visibleMargin;
    expect(moved.x + -140).toBe(margin);
    expect(moved.y + -60).toBe(margin);
    expect(moved.k).toBe(camera.k);
  });

  it("pans a node past the right or bottom edge back inside the margin", () => {
    const node = box(900, 700);
    const moved = ensureVisible(node, camera, VIEWPORT);
    expect(moved.x + node.x + node.width).toBe(VIEWPORT.width - CAMERA_LIMITS.visibleMargin);
    expect(moved.y + node.y + node.height).toBe(
      VIEWPORT.height - CAMERA_LIMITS.visibleMargin,
    );
  });

  it("accounts for zoom when deciding whether a node is off screen", () => {
    const zoomed: Camera = { x: 0, y: 0, k: 2 };
    const node = box(500, 100);
    const moved = ensureVisible(node, zoomed, VIEWPORT);
    expect(moved.x).toBeLessThan(0);
    expect(moved.x + (node.x + node.width) * zoomed.k).toBe(
      VIEWPORT.width - CAMERA_LIMITS.visibleMargin,
    );
    expect(moved.k).toBe(zoomed.k);
  });
});
