import { describe, expect, it } from "vitest";
import { canUseWebGL, resetWebGLCache } from "./webgl";

describe("canUseWebGL", () => {
  it("is false in the node test environment (no document)", () => {
    resetWebGLCache();
    expect(canUseWebGL()).toBe(false);
  });

  it("memoizes the answer", () => {
    resetWebGLCache();
    expect(canUseWebGL()).toBe(canUseWebGL());
  });
});
