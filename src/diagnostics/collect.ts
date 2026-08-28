import { canUseWebGL } from "../canvas/webgl";
import { diagnosticEvents } from "./errorLog";
import { buildDiagnostics, rendererFacts } from "./snapshot";
import type {
  ActiveRenderer,
  DiagnosticsSnapshot,
  EnvironmentFacts,
  PixiFacts,
  PlanFacts,
  RendererChoice,
  SurfaceFacts,
  WebGLFacts,
} from "./types";

/**
 * Measuring side of the diagnostics: it reads the browser, the board's DOM,
 * and whatever the live Pixi host publishes, then hands plain facts to the
 * pure `buildDiagnostics`.
 */

export type RendererProbe = () => PixiFacts | null;

let probe: RendererProbe | null = null;

/** The mounted Pixi host publishes its own state here while it is alive. */
export function setRendererProbe(next: RendererProbe): () => void {
  probe = next;
  return () => {
    if (probe === next) probe = null;
  };
}

export function probeRenderer(): PixiFacts | null {
  try {
    return probe?.() ?? null;
  } catch (error) {
    void error;
    return null;
  }
}

let webglFacts: WebGLFacts | null = null;

/**
 * GPU facts, probed once. Each probe costs a live WebGL context, and browsers
 * cap how many a page may hold, so the answer is cached for the session - it
 * cannot change under us anyway.
 */
export function collectWebGLFacts(): WebGLFacts {
  if (webglFacts) return webglFacts;
  webglFacts = probeWebGLFacts();
  return webglFacts;
}

/** Test hook: forget the cached GPU facts. */
export function resetWebGLFacts(): void {
  webglFacts = null;
}

function probeWebGLFacts(): WebGLFacts {
  const empty: WebGLFacts = {
    supported: false,
    version: null,
    vendor: null,
    renderer: null,
    unmaskedVendor: null,
    unmaskedRenderer: null,
    maxTextureSize: null,
    stencil: false,
    failure: null,
  };
  if (typeof document === "undefined") {
    return { ...empty, failure: "no document (server or test environment)" };
  }
  try {
    const canvas = document.createElement("canvas");
    const attributes: WebGLContextAttributes = { stencil: true };
    const gl2 = canvas.getContext("webgl2", attributes) as
      | WebGL2RenderingContext
      | null;
    const gl =
      gl2 ??
      ((canvas.getContext("webgl", attributes) ??
        canvas.getContext(
          "experimental-webgl",
          attributes,
        )) as WebGLRenderingContext | null);
    if (!gl) {
      return { ...empty, failure: "the browser returned no WebGL context" };
    }
    const debug = gl.getExtension("WEBGL_debug_renderer_info");
    const facts: WebGLFacts = {
      supported: Boolean(gl.getContextAttributes()?.stencil),
      version: gl2 ? "webgl2" : "webgl",
      vendor: readParameter(gl, gl.VENDOR),
      renderer: readParameter(gl, gl.RENDERER),
      unmaskedVendor: debug
        ? readParameter(gl, debug.UNMASKED_VENDOR_WEBGL)
        : null,
      unmaskedRenderer: debug
        ? readParameter(gl, debug.UNMASKED_RENDERER_WEBGL)
        : null,
      maxTextureSize: numberParameter(gl, gl.MAX_TEXTURE_SIZE),
      stencil: Boolean(gl.getContextAttributes()?.stencil),
      failure: null,
    };
    // Hand the context straight back: Pixi needs one of the browser's few.
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return facts;
  } catch (error) {
    return {
      ...empty,
      failure: error instanceof Error ? error.message : String(error),
    };
  }
}

function readParameter(gl: WebGLRenderingContext, name: number): string | null {
  try {
    const value: unknown = gl.getParameter(name);
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

function numberParameter(
  gl: WebGLRenderingContext,
  name: number,
): number | null {
  try {
    const value: unknown = gl.getParameter(name);
    return typeof value === "number" ? value : null;
  } catch {
    return null;
  }
}

export function collectEnvironmentFacts(): EnvironmentFacts {
  if (typeof window === "undefined") {
    return {
      userAgent: "unknown",
      language: "unknown",
      platform: "unknown",
      devicePixelRatio: 1,
      innerWidth: 0,
      innerHeight: 0,
      reducedMotion: false,
      colorScheme: "unknown",
    };
  }
  const matches = (query: string) =>
    typeof window.matchMedia === "function" && window.matchMedia(query).matches;
  return {
    userAgent: navigator.userAgent,
    language: navigator.language,
    platform: navigator.platform,
    devicePixelRatio: window.devicePixelRatio,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    reducedMotion: matches("(prefers-reduced-motion: reduce)"),
    colorScheme: matches("(prefers-color-scheme: dark)")
      ? "dark"
      : matches("(prefers-color-scheme: light)")
        ? "light"
        : "unknown",
  };
}

/** Measured board geometry, read straight off the live DOM. */
export function collectSurfaceFacts(root: ParentNode | null): SurfaceFacts {
  if (!root) return { viewport: null, host: null, canvas: null };
  const viewport = root.querySelector(".tree-viewport");
  const host = root.querySelector(".tree-pixi-host");
  const canvas = host?.querySelector("canvas") ?? null;
  const canvasRect = canvas?.getBoundingClientRect();
  return {
    viewport: viewport
      ? { width: viewport.clientWidth, height: viewport.clientHeight }
      : null,
    host: host ? { width: host.clientWidth, height: host.clientHeight } : null,
    canvas:
      canvas && canvasRect
        ? {
            cssWidth: canvasRect.width,
            cssHeight: canvasRect.height,
            backingWidth: canvas.width,
            backingHeight: canvas.height,
          }
        : null,
  };
}

export interface CollectContext {
  /** What was asked for, and what the tree component says is on screen. */
  preference: RendererChoice;
  active: ActiveRenderer;
  plan: PlanFacts;
  root?: ParentNode | null;
  now?: Date;
}

export function collectDiagnostics(
  context: CollectContext,
): DiagnosticsSnapshot {
  return buildDiagnostics({
    capturedAt: (context.now ?? new Date()).toISOString(),
    environment: collectEnvironmentFacts(),
    webgl: collectWebGLFacts(),
    surface: collectSurfaceFacts(
      context.root ?? (typeof document === "undefined" ? null : document),
    ),
    pixi: context.active === "relic" ? probeRenderer() : null,
    renderer: rendererFacts(context.preference, context.active, canUseWebGL()),
    plan: context.plan,
    events: diagnosticEvents(),
  });
}
