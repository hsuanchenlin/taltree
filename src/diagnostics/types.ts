import type { Camera } from "../graph";

/**
 * The shape of a diagnostics snapshot. Every field is plain JSON so the whole
 * snapshot survives `JSON.stringify` into the clipboard and into local
 * storage, where it can be read back after a test session on someone else's
 * machine.
 */

/** One captured failure. The ring buffer keeps the most recent few. */
export interface DiagnosticEvent {
  at: string;
  source: string;
  message: string;
  stack?: string;
}

export interface EnvironmentFacts {
  userAgent: string;
  language: string;
  platform: string;
  devicePixelRatio: number;
  innerWidth: number;
  innerHeight: number;
  reducedMotion: boolean;
  colorScheme: "light" | "dark" | "unknown";
}

export interface WebGLFacts {
  supported: boolean;
  /** The best context the browser handed out, or null when none did. */
  version: "webgl2" | "webgl" | null;
  vendor: string | null;
  renderer: string | null;
  /** `WEBGL_debug_renderer_info` strings when the browser exposes them. */
  unmaskedVendor: string | null;
  unmaskedRenderer: string | null;
  maxTextureSize: number | null;
  stencil: boolean;
  failure: string | null;
}

/** Measured geometry of the board, its Pixi host, and the canvas inside it. */
export interface SurfaceFacts {
  viewport: { width: number; height: number } | null;
  host: { width: number; height: number } | null;
  canvas: {
    cssWidth: number;
    cssHeight: number;
    backingWidth: number;
    backingHeight: number;
  } | null;
}

export interface PixiFacts {
  isInitialised: boolean;
  stageChildren: number;
  worldBounds: { x: number; y: number; width: number; height: number } | null;
  camera: Camera;
  rendererType: string;
  resolution: number;
  /** Frames the app has presented since mount, counted by the host component. */
  framesRendered: number;
}

export type RendererChoice = "relic" | "classic" | "list";
export type ActiveRenderer = "relic" | "classic" | "list";

export interface RendererFacts {
  /** What the person asked for, from the view switcher. */
  preference: RendererChoice;
  /** What is actually on screen right now. */
  active: ActiveRenderer;
  webglAvailable: boolean;
  pixiFailed: boolean;
}

export interface PlanFacts {
  title: string;
  nodeCount: number;
  edgeCount: number;
  layout: { width: number; height: number };
}

export interface DiagnosticsInput {
  capturedAt: string;
  environment: EnvironmentFacts;
  webgl: WebGLFacts;
  surface: SurfaceFacts;
  pixi: PixiFacts | null;
  renderer: RendererFacts;
  plan: PlanFacts;
  events: readonly DiagnosticEvent[];
}

export interface DiagnosticsSnapshot extends DiagnosticsInput {
  /** Human-readable conclusions derived from the facts above. */
  findings: string[];
}
