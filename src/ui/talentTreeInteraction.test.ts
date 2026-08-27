import { describe, expect, it } from "vitest";
import { isPointInsideViewport } from "./talentTreeInteraction";

const bounds = { left: 10, right: 110, top: 20, bottom: 120 };

describe("isPointInsideViewport", () => {
  it("recognizes a release inside the viewport", () => {
    expect(isPointInsideViewport(bounds, { clientX: 50, clientY: 60 })).toBe(true);
  });

  it("recognizes a release outside the viewport", () => {
    expect(isPointInsideViewport(bounds, { clientX: 120, clientY: 60 })).toBe(false);
  });
});
