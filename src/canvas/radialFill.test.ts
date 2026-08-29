import { describe, expect, it } from "vitest";
import {
  compositeAlphas,
  compositeCoverage,
  mixColor,
  radialRadii,
  radialSteps,
} from "./radialFill";

describe("radialRadii", () => {
  it("runs from the rim inwards so later circles paint over earlier ones", () => {
    const radii = radialRadii(56);
    expect(radii[0]).toBe(56);
    expect(radii).toHaveLength(radialSteps(56));
    for (let i = 1; i < radii.length; i += 1) {
      expect(radii[i]!).toBeLessThan(radii[i - 1]!);
    }
  });

  it("ends at zero, so the ring before it carries colour into the centre", () => {
    expect(radialRadii(56).at(-1)).toBe(0);
  });

  it("keeps at least two rings however few are asked for", () => {
    expect(radialRadii(10, 1)).toEqual([10, 0]);
  });

  it("scales the ring count with the radius, so a wide fill does not band", () => {
    expect(radialSteps(60)).toBeGreaterThan(radialSteps(20));
    expect(radialSteps(0.1)).toBe(8);
  });
});

describe("mixColor", () => {
  it("returns the endpoints unchanged", () => {
    expect(mixColor(0x46c78f, 0x103b30, 0)).toBe(0x46c78f);
    expect(mixColor(0x46c78f, 0x103b30, 1)).toBe(0x103b30);
  });

  it("blends each channel independently", () => {
    expect(mixColor(0x000000, 0xffffff, 0.5)).toBe(0x808080);
    expect(mixColor(0xff0000, 0x0000ff, 0.5)).toBe(0x800080);
  });

  it("clamps out-of-range blends to the endpoints", () => {
    expect(mixColor(0x102030, 0x405060, -1)).toBe(0x102030);
    expect(mixColor(0x102030, 0x405060, 2)).toBe(0x405060);
  });
});

describe("compositeAlphas", () => {
  it("composites back to the opacities the fill asked for", () => {
    const targets = [0, 0.15, 0.45, 0.7, 0.9, 1];
    const coverage = compositeCoverage(compositeAlphas(targets));
    for (let i = 0; i < targets.length; i += 1) {
      expect(coverage[i]!).toBeCloseTo(targets[i]!, 6);
    }
  });

  it("paints nothing more once the stack is already opaque", () => {
    expect(compositeAlphas([1, 1, 0.5])).toEqual([1, 0, 0]);
  });

  it("cannot subtract coverage, so a falling target stays where it was", () => {
    const alphas = compositeAlphas([0.6, 0.2]);
    expect(alphas[1]).toBe(0);
    expect(compositeCoverage(alphas)[1]).toBeCloseTo(0.6, 6);
  });

  it("clamps opacities outside 0..1 before compositing", () => {
    expect(compositeAlphas([-1, 2])).toEqual([0, 1]);
  });
});
