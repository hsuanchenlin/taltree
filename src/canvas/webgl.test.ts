import { afterEach, describe, expect, it } from "vitest";
import { canUseWebGL, resetWebGLCache } from "./webgl";

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
