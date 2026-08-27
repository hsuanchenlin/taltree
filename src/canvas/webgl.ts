/**
 * One-shot WebGL capability check. Returns false under SSR / Vitest (no
 * document) and on software-render machines, so the tree falls back to the
 * SVG/DOM renderer. Memoized: the answer cannot change during a session.
 */

let cached: boolean | null = null;

export function canUseWebGL(): boolean {
  if (cached !== null) return cached;
  if (typeof document === "undefined") {
    cached = false;
    return cached;
  }
  try {
    const canvas = document.createElement("canvas");
    cached = Boolean(
      canvas.getContext("webgl2") ?? canvas.getContext("webgl"),
    );
  } catch {
    cached = false;
  }
  return cached;
}

/** Test hook: reset the memoized answer. */
export function resetWebGLCache(): void {
  cached = null;
}
