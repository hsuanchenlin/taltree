/**
 * One-shot WebGL capability check. Returns false under SSR / Vitest (no
 * document) and on software-render machines, so the tree falls back to the
 * SVG/DOM renderer. Memoized: the answer cannot change during a session.
 *
 * The probe mirrors Pixi's own `isWebGLSupported`: a stencil-capable WebGL1
 * context. Anything weaker makes Pixi reject `app.init()` asynchronously, which
 * is far more expensive to recover from than never mounting the stage.
 */

let cached: boolean | null = null;

export function canUseWebGL(): boolean {
  if (cached !== null) return cached;
  cached = probeWebGL();
  return cached;
}

function probeWebGL(): boolean {
  if (typeof document === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl", { stencil: true });
    const supported = Boolean(gl?.getContextAttributes()?.stencil);
    // Release the probe context so it does not count against the browser's
    // live-context budget when Pixi asks for the real one.
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
    return supported;
  } catch {
    return false;
  }
}

/** Test hook: reset the memoized answer. */
export function resetWebGLCache(): void {
  cached = null;
}

const RENDERER_MESSAGE = /webgl|webgpu|renderer|graphics|\bgpu\b|pixi/i;
/** Only names a bundle can carry: a generic word here would match anything. */
const RENDERER_STACK = /webgl|webgpu|pixi/i;

/**
 * Whether an unhandled rejection plausibly came from Pixi's renderer bring-up.
 * The stage watches page-global rejections because `@pixi/react` swallows its
 * own `app.init()` failure, so unrelated rejections must not be mistaken for it.
 */
export function isRendererInitFailure(reason: unknown): boolean {
  if (typeof reason === "string") return RENDERER_MESSAGE.test(reason);
  if (!(reason instanceof Error)) return false;
  return (
    RENDERER_MESSAGE.test(reason.message) ||
    RENDERER_STACK.test(reason.stack ?? "")
  );
}
