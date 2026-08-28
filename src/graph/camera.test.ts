import { describe, expect, it } from "vitest";
import {
  CAMERA_LIMITS,
  CAMERA_MOTION,
  centerCameraOn,
  clampCameraToContent,
  clampZoom,
  contentOnScreen,
  contentScreenRect,
  dragVelocity,
  easeOutCubic,
  ensureVisible,
  fitCamera,
  glideStopped,
  initialCamera,
  lerpCamera,
  READABLE_CAMERA,
  rebaseDragOrigin,
  shouldGlide,
  stepMomentum,
  visibleContentSize,
  zoomAbout,
  zoomEase,
  zoomSettled,
} from "./camera";
import type { Camera, CameraVelocity } from "./camera";

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

describe("initialCamera", () => {
  it("opens on the fitted, centred camera when nothing is selected", () => {
    const tree = { width: 2000, height: 300 };
    expect(initialCamera(tree, VIEWPORT)).toEqual(fitCamera(tree, VIEWPORT));
  });

  it("keeps the fit when the selected node already sits inside it", () => {
    const tree = { width: 400, height: 300 };
    const fitted = fitCamera(tree, VIEWPORT);
    expect(initialCamera(tree, VIEWPORT, box(100, 80))).toEqual(fitted);
  });

  it("pans off the fit to reveal a selection the clamped zoom left outside", () => {
    const tree = { width: 100000, height: 100000 };
    const camera = initialCamera(tree, VIEWPORT, box(99000, 99000));
    expect(camera.k).toBe(CAMERA_LIMITS.minZoom);
    const margin = CAMERA_LIMITS.visibleMargin;
    expect(camera.x + 99000 * camera.k + 200 * camera.k).toBeCloseTo(
      VIEWPORT.width - margin,
      10,
    );
    expect(camera.y + 99000 * camera.k + 124 * camera.k).toBeCloseTo(
      VIEWPORT.height - margin,
      10,
    );
  });

  it("falls back to the readable origin before the viewport is measured", () => {
    expect(initialCamera({ width: 900, height: 400 }, { width: 0, height: 0 })).toEqual(
      READABLE_CAMERA,
    );
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

describe("dragVelocity", () => {
  it("measures pixels per second across the velocity window", () => {
    const velocity = dragVelocity([
      { x: 0, y: 0, t: 0 },
      { x: 50, y: 0, t: 50 },
      { x: 100, y: -20, t: 100 },
    ]);
    expect(velocity.vx).toBeCloseTo(1000, 10);
    expect(velocity.vy).toBeCloseTo(-200, 10);
  });

  it("ignores samples older than the window so a flick survives a slow start", () => {
    const samples = [
      { x: 0, y: 0, t: 0 },
      { x: 5, y: 0, t: 500 },
      { x: 45, y: 0, t: 550 },
      { x: 85, y: 0, t: 600 },
    ];
    const velocity = dragVelocity(samples);
    expect(velocity.vx).toBeCloseTo(800, 10);
  });

  it("returns zero for a stationary or single sample", () => {
    expect(dragVelocity([])).toEqual({ vx: 0, vy: 0 });
    expect(dragVelocity([{ x: 3, y: 4, t: 10 }])).toEqual({ vx: 0, vy: 0 });
    expect(
      dragVelocity([
        { x: 3, y: 4, t: 10 },
        { x: 3, y: 4, t: 60 },
      ]),
    ).toEqual({ vx: 0, vy: 0 });
  });
});

describe("momentum panning", () => {
  const frame = CAMERA_MOTION.referenceFrameMs;

  it("only glides past the minimum release speed", () => {
    expect(shouldGlide({ vx: 30, vy: 20 })).toBe(false);
    expect(shouldGlide({ vx: 40.1, vy: 0 })).toBe(true);
    expect(shouldGlide({ vx: 0, vy: -100 })).toBe(true);
  });

  it("advances the camera by velocity and decays by the friction constant", () => {
    const camera: Camera = { x: 10, y: 20, k: 1.5 };
    const velocity: CameraVelocity = { vx: 600, vy: -300 };
    const step = stepMomentum(camera, velocity, frame);
    expect(step.camera.x).toBeCloseTo(10 + 600 * (frame / 1000), 10);
    expect(step.camera.y).toBeCloseTo(20 - 300 * (frame / 1000), 10);
    expect(step.camera.k).toBe(1.5);
    expect(step.velocity.vx).toBeCloseTo(600 * CAMERA_MOTION.frictionPerFrame, 10);
    expect(step.velocity.vy).toBeCloseTo(-300 * CAMERA_MOTION.frictionPerFrame, 10);
  });

  it("decays to rest instead of drifting forever", () => {
    let camera: Camera = { x: 0, y: 0, k: 1 };
    let velocity: CameraVelocity = { vx: 800, vy: 0 };
    let frames = 0;
    while (!glideStopped(velocity) && frames < 1000) {
      const step = stepMomentum(camera, velocity, frame);
      camera = step.camera;
      velocity = step.velocity;
      frames += 1;
    }
    expect(frames).toBeGreaterThan(10);
    expect(frames).toBeLessThan(1000);
    expect(velocity).toEqual({ vx: 0, vy: 0 });
    // Total coast distance of an exponential decay: v0 * dt / (1 - friction).
    const expected = 800 * (frame / 1000) * (1 / (1 - CAMERA_MOTION.frictionPerFrame));
    expect(camera.x).toBeGreaterThan(expected * 0.9);
    expect(camera.x).toBeLessThan(expected);
  });

  it("damps by elapsed time, not by frame count", () => {
    const velocity: CameraVelocity = { vx: 500, vy: 0 };
    const whole = stepMomentum({ x: 0, y: 0, k: 1 }, velocity, frame).velocity;
    const half = stepMomentum({ x: 0, y: 0, k: 1 }, velocity, frame / 2).velocity;
    const halved = stepMomentum({ x: 0, y: 0, k: 1 }, half, frame / 2).velocity;
    expect(halved.vx).toBeCloseTo(whole.vx, 6);
  });

  it("stops cleanly once it falls below the stop speed", () => {
    const stop = CAMERA_MOTION.stopPxPerFrame * 60;
    const step = stepMomentum(
      { x: 0, y: 0, k: 1 },
      { vx: stop * 1.05 * CAMERA_MOTION.frictionPerFrame, vy: 0 },
      frame,
    );
    expect(step.velocity).toEqual({ vx: 0, vy: 0 });
    expect(glideStopped(step.velocity)).toBe(true);
  });
});

describe("lerpCamera", () => {
  const from: Camera = { x: 0, y: 100, k: 0.5 };
  const to: Camera = { x: 200, y: -100, k: 1.5 };

  it("honours the interpolation endpoints and midpoint", () => {
    expect(lerpCamera(from, to, 0)).toEqual(from);
    expect(lerpCamera(from, to, 1)).toEqual(to);
    expect(lerpCamera(from, to, 0.5)).toEqual({ x: 100, y: 0, k: 1 });
  });

  it("clamps t to the 0..1 range", () => {
    expect(lerpCamera(from, to, -2)).toEqual(from);
    expect(lerpCamera(from, to, 3)).toEqual(to);
  });

  it("keeps zoom inside the camera limits while lerping past them", () => {
    const wide = lerpCamera({ x: 0, y: 0, k: CAMERA_LIMITS.minZoom }, { x: 0, y: 0, k: 0.01 }, 1);
    expect(wide.k).toBe(CAMERA_LIMITS.minZoom);
    const tight = lerpCamera({ x: 0, y: 0, k: CAMERA_LIMITS.maxZoom }, { x: 0, y: 0, k: 99 }, 0.9);
    expect(tight.k).toBeLessThanOrEqual(CAMERA_LIMITS.maxZoom);
  });
});

describe("smooth zoom easing", () => {
  it("covers the same distance per second regardless of frame rate", () => {
    const whole = zoomEase(CAMERA_MOTION.referenceFrameMs);
    const half = zoomEase(CAMERA_MOTION.referenceFrameMs / 2);
    expect(1 - whole).toBeCloseTo((1 - half) * (1 - half), 10);
  });

  it("settles only within the snap tolerances", () => {
    const target: Camera = { x: 100, y: 50, k: 1.2 };
    expect(zoomSettled(target, target)).toBe(true);
    expect(zoomSettled({ ...target, x: target.x + 5 }, target)).toBe(false);
    expect(zoomSettled({ ...target, k: target.k + 0.01 }, target)).toBe(false);
  });
});

describe("rebaseDragOrigin", () => {
  const origin = { camX: 40, camY: -25 };

  it("absorbs a camera shift so the next drag delta keeps it", () => {
    const from: Camera = { x: 100, y: 200, k: 1 };
    const to = zoomAbout(from, 1.15, { x: 400, y: 300 });
    const rebased = rebaseDragOrigin(origin, from, to);
    const dragDelta = { x: 60, y: -35 };
    expect(rebased.camX + dragDelta.x).toBeCloseTo(
      origin.camX + dragDelta.x + (to.x - from.x),
      10,
    );
    expect(rebased.camY + dragDelta.y).toBeCloseTo(
      origin.camY + dragDelta.y + (to.y - from.y),
      10,
    );
  });

  it("leaves the origin alone when the camera only changed zoom", () => {
    const camera: Camera = { x: 100, y: 200, k: 1 };
    expect(rebaseDragOrigin(origin, camera, { ...camera, k: 2 })).toEqual(origin);
  });
});

describe("focus animation", () => {
  it("easeOutCubic anchors the endpoints and leads linear mid-flight", () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(0.5)).toBeCloseTo(0.875, 10);
  });

  it("centerCameraOn puts the node center at the viewport center", () => {
    const node = box(400, 300);
    const camera: Camera = { x: 0, y: 0, k: 1.6 };
    const focused = centerCameraOn(node, camera, VIEWPORT);
    expect(focused.k).toBe(camera.k);
    expect(focused.x + (node.x + node.width / 2) * camera.k).toBeCloseTo(
      VIEWPORT.width / 2,
      10,
    );
    expect(focused.y + (node.y + node.height / 2) * camera.k).toBeCloseTo(
      VIEWPORT.height / 2,
      10,
    );
  });
});

describe("keeping the tree on the board", () => {
  const layout = { width: 1200, height: 900 };

  it("maps the tree's screen rectangle from the camera", () => {
    expect(contentScreenRect(layout, { x: 40, y: 20, k: 0.5 })).toEqual({
      left: 40,
      top: 20,
      right: 640,
      bottom: 470,
    });
  });

  it("measures how much of the tree the board shows", () => {
    expect(
      visibleContentSize(layout, { x: -200, y: -100, k: 1 }, VIEWPORT),
    ).toEqual({ width: 800, height: 600 });
    expect(
      visibleContentSize(layout, { x: 760, y: 560, k: 1 }, VIEWPORT),
    ).toEqual({ width: 40, height: 40 });
  });

  it("reports a tree that has left the board entirely", () => {
    expect(contentOnScreen(layout, { x: 0, y: 0, k: 1 }, VIEWPORT)).toBe(true);
    expect(
      contentOnScreen(layout, { x: -1300, y: 0, k: 1 }, VIEWPORT),
    ).toBe(false);
    expect(contentOnScreen(layout, { x: 900, y: 0, k: 1 }, VIEWPORT)).toBe(
      false,
    );
  });

  it("leaves a camera that already shows the tree untouched", () => {
    const camera: Camera = { x: -100, y: -50, k: 1 };
    expect(clampCameraToContent(layout, camera, VIEWPORT)).toBe(camera);
  });

  it("pulls a camera that pushed the tree off the right edge back into view", () => {
    const clamped = clampCameraToContent(
      layout,
      { x: 5000, y: 0, k: 1 },
      VIEWPORT,
    );
    expect(clamped.x).toBe(VIEWPORT.width - CAMERA_LIMITS.keepVisiblePx);
    expect(contentOnScreen(layout, clamped, VIEWPORT)).toBe(true);
  });

  it("pulls a camera that pushed the tree off the top-left back into view", () => {
    const clamped = clampCameraToContent(
      layout,
      { x: -9000, y: -9000, k: 1 },
      VIEWPORT,
    );
    expect(clamped.x).toBe(CAMERA_LIMITS.keepVisiblePx - layout.width);
    expect(clamped.y).toBe(CAMERA_LIMITS.keepVisiblePx - layout.height);
    expect(contentOnScreen(layout, clamped, VIEWPORT)).toBe(true);
  });

  it("keeps the whole of a tree smaller than the keep-visible margin reachable", () => {
    const tiny = { width: 40, height: 30 };
    const clamped = clampCameraToContent(tiny, { x: 4000, y: 0, k: 1 }, VIEWPORT);
    expect(contentOnScreen(tiny, clamped, VIEWPORT)).toBe(true);
  });

  it("scales the clamp with the zoom", () => {
    const clamped = clampCameraToContent(
      layout,
      { x: -9000, y: 0, k: 0.5 },
      VIEWPORT,
    );
    expect(clamped.x).toBe(CAMERA_LIMITS.keepVisiblePx - layout.width * 0.5);
  });

  it("leaves an unmeasured board alone, having nothing to clamp against", () => {
    const camera: Camera = { x: 5000, y: 5000, k: 1 };
    expect(
      clampCameraToContent(layout, camera, { width: 0, height: 0 }),
    ).toBe(camera);
  });

  it("keeps a fitted camera exactly where the fit put it", () => {
    const fitted = fitCamera(layout, VIEWPORT);
    expect(clampCameraToContent(layout, fitted, VIEWPORT)).toBe(fitted);
  });
});
