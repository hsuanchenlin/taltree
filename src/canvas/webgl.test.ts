import { afterEach, describe, expect, it } from "vitest";
import { canUseWebGL, isRendererInitFailure, resetWebGLCache } from "./webgl";

interface FakeContext {
  getContextAttributes: () => { stencil: boolean };
  getExtension: (name: string) => { loseContext: () => void } | null;
}

function withStubbedCanvas(context: FakeContext | null, lost: string[] = []) {
  const stub = {
    createElement: () => ({
      getContext: () =>
        context
          ? {
              ...context,
              getExtension: (name: string) =>
                name === "WEBGL_lose_context"
                  ? { loseContext: () => lost.push(name) }
                  : null,
            }
          : null,
    }),
  };
  Object.defineProperty(globalThis, "document", {
    value: stub,
    configurable: true,
    writable: true,
  });
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, "document");
  resetWebGLCache();
});

describe("canUseWebGL", () => {
  it("is false in the node test environment (no document)", () => {
    resetWebGLCache();
    expect(canUseWebGL()).toBe(false);
  });

  it("memoizes the answer", () => {
    resetWebGLCache();
    expect(canUseWebGL()).toBe(canUseWebGL());
  });

  it("accepts a stencil-capable context and releases the probe", () => {
    const lost: string[] = [];
    withStubbedCanvas(
      {
        getContextAttributes: () => ({ stencil: true }),
        getExtension: () => null,
      },
      lost,
    );
    resetWebGLCache();
    expect(canUseWebGL()).toBe(true);
    expect(lost).toEqual(["WEBGL_lose_context"]);
  });

  it("rejects a context without stencil, which Pixi's own probe also rejects", () => {
    withStubbedCanvas({
      getContextAttributes: () => ({ stencil: false }),
      getExtension: () => null,
    });
    resetWebGLCache();
    expect(canUseWebGL()).toBe(false);
  });

  it("rejects a canvas that hands back no context", () => {
    withStubbedCanvas(null);
    resetWebGLCache();
    expect(canUseWebGL()).toBe(false);
  });
});

describe("isRendererInitFailure", () => {
  it("claims the rejections Pixi's renderer bring-up actually throws", () => {
    expect(
      isRendererInitFailure(
        new Error("No available renderer for the current environment"),
      ),
    ).toBe(true);
    expect(isRendererInitFailure(new Error("Failed to create WebGL context"))).toBe(
      true,
    );
    expect(isRendererInitFailure("WebGL unsupported")).toBe(true);
  });

  it("claims a rejection thrown from inside the pixi chunk", () => {
    const error = new Error("Cannot read properties of undefined");
    error.stack = "Error\n    at init (/assets/pixi_js-a1b2c3.js:12:9)";
    expect(isRendererInitFailure(error)).toBe(true);
  });

  it("leaves unrelated rejections alone so they cannot demote a live slab", () => {
    const unrelated = new Error("Failed to fetch");
    unrelated.stack = "Error\n    at loadPlan (/assets/index-a1b2c3.js:4:1)";
    expect(isRendererInitFailure(unrelated)).toBe(false);
    expect(isRendererInitFailure("user cancelled")).toBe(false);
    expect(isRendererInitFailure(undefined)).toBe(false);
    expect(isRendererInitFailure({ message: "webgl" })).toBe(false);
  });
});
