import { beforeEach, describe, expect, it } from "vitest";
import {
  buildDiagnostics,
  DIAGNOSTICS_STORAGE_KEY,
  diagnosticFindings,
  formatDiagnostics,
  readDiagnostics,
  rendererFacts,
  writeDiagnostics,
} from "./snapshot";
import type { DiagnosticsInput } from "./types";

function input(overrides: Partial<DiagnosticsInput> = {}): DiagnosticsInput {
  return {
    capturedAt: "2026-08-28T09:00:00.000Z",
    environment: {
      userAgent: "test",
      language: "en",
      platform: "test",
      devicePixelRatio: 2,
      innerWidth: 1280,
      innerHeight: 800,
      reducedMotion: false,
      colorScheme: "light",
    },
    webgl: {
      supported: true,
      version: "webgl2",
      vendor: "Test",
      renderer: "Test GPU",
      unmaskedVendor: "Apple",
      unmaskedRenderer: "Apple M-series",
      maxTextureSize: 16384,
      stencil: true,
      failure: null,
    },
    surface: {
      viewport: { width: 800, height: 600 },
      host: { width: 800, height: 600 },
      canvas: {
        cssWidth: 800,
        cssHeight: 600,
        backingWidth: 1600,
        backingHeight: 1200,
      },
    },
    pixi: {
      isInitialised: true,
      stageChildren: 1,
      worldBounds: { x: 0, y: 0, width: 400, height: 300 },
      camera: { x: 100, y: 100, k: 1 },
      rendererType: "webgl",
      resolution: 2,
      framesRendered: 12,
    },
    renderer: {
      preference: "relic",
      active: "relic",
      webglAvailable: true,
      pixiFailed: false,
    },
    plan: {
      title: "A full Thursday",
      nodeCount: 9,
      edgeCount: 6,
      layout: { width: 400, height: 300 },
    },
    events: [],
    ...overrides,
  };
}

describe("diagnosticFindings", () => {
  it("reports nothing when a healthy relic board is drawing the tree", () => {
    expect(diagnosticFindings(input())).toEqual([]);
  });

  it("names a zero-sized drawing buffer", () => {
    const findings = diagnosticFindings(
      input({
        surface: {
          viewport: { width: 800, height: 600 },
          host: { width: 800, height: 600 },
          canvas: {
            cssWidth: 800,
            cssHeight: 600,
            backingWidth: 0,
            backingHeight: 0,
          },
        },
      }),
    );
    expect(findings.join(" ")).toContain("drawing buffer is 0x0");
  });

  it("names a canvas that no longer matches the host it should fill", () => {
    const findings = diagnosticFindings(
      input({
        surface: {
          viewport: { width: 400, height: 300 },
          host: { width: 400, height: 300 },
          canvas: {
            cssWidth: 829,
            cssHeight: 638,
            backingWidth: 829,
            backingHeight: 638,
          },
        },
      }),
    );
    expect(findings.join(" ")).toContain("does not match its host");
  });

  it("names a camera that has pushed the whole tree off the board", () => {
    const findings = diagnosticFindings(
      input({
        pixi: {
          ...input().pixi!,
          camera: { x: -900, y: 0, k: 1 },
        },
      }),
    );
    expect(findings.join(" ")).toContain("entirely outside the board");
  });

  it("names a stage that never rendered a frame", () => {
    const findings = diagnosticFindings(
      input({
        pixi: { ...input().pixi!, framesRendered: 0, stageChildren: 0 },
      }),
    );
    expect(findings.join(" ")).toContain("not presented a single frame");
    expect(findings.join(" ")).toContain("no children");
  });

  it("explains a missing WebGL context without blaming the camera", () => {
    const findings = diagnosticFindings(
      input({
        webgl: {
          ...input().webgl,
          supported: false,
          version: null,
          failure: "the browser returned no WebGL context",
        },
        renderer: {
          preference: "relic",
          active: "classic",
          webglAvailable: false,
          pixiFailed: false,
        },
        pixi: null,
      }),
    );
    expect(findings.join(" ")).toContain("WebGL is unavailable");
    expect(findings.join(" ")).not.toContain("camera");
  });

  it("counts captured errors", () => {
    const findings = diagnosticFindings(
      input({
        events: [
          { at: "2026-08-28T09:00:00.000Z", source: "pixi.init", message: "boom" },
        ],
      }),
    );
    expect(findings.join(" ")).toContain("1 error was captured");
  });
});

describe("diagnostics storage", () => {
  const store = new Map<string, string>();
  const storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
  };

  beforeEach(() => store.clear());

  it("round-trips a snapshot through the documented key", () => {
    const snapshot = buildDiagnostics(input());
    writeDiagnostics(storage, snapshot);
    expect(store.has(DIAGNOSTICS_STORAGE_KEY)).toBe(true);
    expect(readDiagnostics(storage)).toEqual(snapshot);
  });

  it("survives a storage that refuses to write", () => {
    expect(() =>
      writeDiagnostics(
        {
          setItem: () => {
            throw new Error("quota exceeded");
          },
        },
        buildDiagnostics(input()),
      ),
    ).not.toThrow();
  });

  it("returns null rather than throwing on unreadable stored text", () => {
    store.set(DIAGNOSTICS_STORAGE_KEY, "{not json");
    expect(readDiagnostics(storage)).toBeNull();
  });

  it("formats as pretty JSON so a pasted snapshot stays readable", () => {
    const text = formatDiagnostics(buildDiagnostics(input()));
    expect(text.endsWith("\n")).toBe(true);
    expect(text).toContain('"findings"');
    expect(JSON.parse(text).plan.nodeCount).toBe(9);
  });
});

describe("rendererFacts", () => {
  it("calls the slab failed only when WebGL was there and the classic tree won", () => {
    expect(rendererFacts("relic", "classic", true).pixiFailed).toBe(true);
    expect(rendererFacts("relic", "relic", true).pixiFailed).toBe(false);
    // No WebGL means there was never a slab to fail.
    expect(rendererFacts("relic", "classic", false).pixiFailed).toBe(false);
    // The classic tree was asked for, so running it is not a failure.
    expect(rendererFacts("classic", "classic", true).pixiFailed).toBe(false);
  });

  it("carries the choice and the active renderer through unchanged", () => {
    expect(rendererFacts("classic", "list", true)).toEqual({
      preference: "classic",
      active: "list",
      webglAvailable: true,
      pixiFailed: false,
    });
  });
});
