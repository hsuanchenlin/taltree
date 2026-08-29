import { Application as PixiApplication } from "pixi.js";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  advanceBlankWatch,
  BLANK_ATTEMPTS,
  BLANK_STRIKES,
  BLANK_WATCH_MS,
  classifyBlankSample,
  socketProbePoints,
  startBlankWatch,
} from "../canvas/blankBoard";
import type { ClearColor } from "../canvas/blankBoard";
import {
  applyCanvasFillStyle,
  hostContentSize,
  resizeRendererToHost,
} from "../canvas/canvasSize";
import { RelicWorld } from "../canvas/world";
import { recordDiagnosticEvent, setRendererProbe } from "../diagnostics";
import type { PixiFacts } from "../diagnostics";
import type { Camera, LaidOutGraph } from "../graph";

/**
 * The WebGL relic-slab stage. Loaded lazily from `TalentTree` so first paint
 * and the list view never wait on the pixi chunk. The scene itself is the
 * imperative `RelicWorld`.
 */

interface TalentTreePixiProps {
  tree: LaidOutGraph;
  camera: Camera;
  hoveredId: string | null;
}

const INIT_TIMEOUT_MS = 10_000;

/** The board's clear colour, as the background passed to `app.init` below. */
const BOARD_BACKGROUND = 0x0c1016;
const CLEAR_COLOR: ClearColor = {
  r: (BOARD_BACKGROUND >> 16) & 0xff,
  g: (BOARD_BACKGROUND >> 8) & 0xff,
  b: BOARD_BACKGROUND & 0xff,
};
/** Side of the block read back at each probe point, in device pixels. */
const PROBE_BLOCK = 6;

function resolveResolution(): number {
  if (typeof window === "undefined") return 1;
  const nav = navigator as Navigator & {
    deviceMemory?: number;
    connection?: { saveData?: boolean };
  };
  const constrained =
    (nav.deviceMemory !== undefined && nav.deviceMemory <= 2) ||
    nav.connection?.saveData === true;
  return constrained ? 1 : Math.min(window.devicePixelRatio || 1, 2);
}

function rendererName(app: PixiApplication): string {
  const renderer = app.renderer as unknown as {
    name?: string;
    type?: number;
  } | null;
  if (!renderer) return "none";
  return renderer.name ?? `type ${String(renderer.type)}`;
}

export default function TalentTreePixi({
  tree,
  camera,
  hoveredId,
}: TalentTreePixiProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<RelicWorld | null>(null);
  const [rendererFailure, setRendererFailure] = useState<Error | null>(null);
  // Set by the mount effect once the application can paint. The prop effects
  // call it so a scene change lands even when the ticker is being throttled.
  const renderNowRef = useRef<(() => void) | null>(null);
  const latestRef = useRef({ tree, camera, hoveredId });
  latestRef.current = { tree, camera, hoveredId };

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let active = true;
    let ready = false;
    let failed = false;
    let frames = 0;
    // The effect owns its canvas, not React. A canvas element holds exactly one
    // WebGL context, so under StrictMode's mount-cleanup-mount (or a fast
    // refresh) the first application's deferred destroy would otherwise kill
    // the context its replacement is already rendering with - the blank,
    // error-free slab this guards against.
    const canvas = document.createElement("canvas");
    applyCanvasFillStyle(canvas.style);
    host.appendChild(canvas);
    const app = new PixiApplication();
    function dispose() {
      try {
        app.destroy(false, { children: true });
        return;
      } catch {
        try {
          app.stage?.destroy({ children: true });
        } catch (error) {
          void error;
        }
        try {
          app.renderer?.destroy(true);
        } catch (error) {
          void error;
        }
      }
    }
    /**
     * Present one frame now. Pixi paints from its ticker, and a ticker is only
     * as reliable as `requestAnimationFrame`: a background tab, a throttled
     * timer, or a mount that finishes between frames all leave the canvas
     * showing nothing but its clear colour. Every event that changes what the
     * board should show ends with a direct render so a frame exists regardless.
     */
    function renderNow() {
      if (!ready || !active) return;
      try {
        app.render();
        frames += 1;
      } catch (error) {
        failRenderer("pixi.render", error);
      }
    }
    function failRenderer(source: string, reason: unknown) {
      if (!active || failed) return;
      failed = true;
      const failure =
        reason instanceof Error ? reason : new Error(String(reason));
      recordDiagnosticEvent(source, failure);
      setRendererFailure(failure);
    }
    /**
     * Watchdog for the one renderer failure that never throws: Pixi
     * initialises, the ticker counts frames, the canvas is sized correctly -
     * and the board still shows nothing but its clear colour. Nothing to catch
     * means nothing falls back, so the drawing buffer is read back where a
     * socket must have been painted. Three blank readings in a row fail the
     * slab on purpose, and if nothing has been confirmed painted within
     * `BLANK_WATCH_MS` the classic tree takes over rather than leaving a
     * black rectangle.
     */
    let blankState = startBlankWatch(0, BLANK_WATCH_MS);
    let blankWatch: number | null = null;
    let paintDeadline: ReturnType<typeof window.setTimeout> | null = null;
    // Hoisted function declarations lose the null narrowing above, so the
    // watchdog reads the board through an alias that carries it.
    const board: HTMLDivElement = host;
    function readProbe(
      gl: WebGLRenderingContext,
      x: number,
      y: number,
      resolution: number,
    ): Uint8Array | null {
      const left = Math.round(x * resolution - PROBE_BLOCK / 2);
      // `readPixels` counts rows from the bottom of the drawing buffer.
      const bottom = Math.round(
        gl.drawingBufferHeight - y * resolution - PROBE_BLOCK / 2,
      );
      if (
        left < 0 ||
        bottom < 0 ||
        left + PROBE_BLOCK > gl.drawingBufferWidth ||
        bottom + PROBE_BLOCK > gl.drawingBufferHeight
      ) {
        return null;
      }
      const pixels = new Uint8Array(PROBE_BLOCK * PROBE_BLOCK * 4);
      gl.readPixels(
        left,
        bottom,
        PROBE_BLOCK,
        PROBE_BLOCK,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        pixels,
      );
      return pixels;
    }
    function applyBlankObservation(
      observation: "inconclusive" | "blank" | "painted",
    ) {
      const transition = advanceBlankWatch(
        blankState,
        observation,
        performance.now(),
        BLANK_WATCH_MS,
        BLANK_ATTEMPTS,
        BLANK_STRIKES,
      );
      blankState = transition.state;
      if (transition.action === "retry") {
        blankWatch = requestAnimationFrame(checkBoardPainted);
      } else if (transition.action === "fail") {
        failRenderer(
          "pixi.blank",
          new Error(
            "The relic slab presented frames but painted no socket art on the board.",
          ),
        );
      }
    }
    function promptBlankWatch() {
      if (blankState.phase !== "stopped" && blankWatch === null) {
        blankWatch = requestAnimationFrame(checkBoardPainted);
      }
    }
    function checkBoardPainted() {
      blankWatch = null;
      if (!ready || !active || failed) return;
      const gl = (app.renderer as unknown as { gl?: WebGLRenderingContext })
        .gl;
      if (!gl || typeof gl.readPixels !== "function") {
        applyBlankObservation("inconclusive");
        return;
      }
      if (document.visibilityState !== "visible") {
        applyBlankObservation("inconclusive");
        return;
      }
      const points = socketProbePoints(
        latestRef.current.tree.nodes,
        latestRef.current.camera,
        { width: board.clientWidth, height: board.clientHeight },
      );
      if (points.length === 0) {
        applyBlankObservation("inconclusive");
        return;
      }
      // Present a frame here, so what is read back is the frame just drawn
      // rather than whatever survived the last compositing pass.
      renderNow();
      const resolution = app.renderer.resolution || 1;
      let blank = false;
      let painted = false;
      try {
        for (const point of points) {
          const pixels = readProbe(gl, point.x, point.y, resolution);
          if (!pixels) continue;
          const result = classifyBlankSample(pixels, CLEAR_COLOR);
          if (result === "painted") {
            painted = true;
            break;
          }
          if (result === "blank") blank = true;
        }
      } catch (error) {
        // A context that will not be read cannot testify either way.
        recordDiagnosticEvent("pixi.blankProbe", error);
        applyBlankObservation("inconclusive");
        return;
      }
      if (painted) {
        applyBlankObservation("painted");
        return;
      }
      applyBlankObservation(blank ? "blank" : "inconclusive");
    }
    // A lost context presents as a blank slab with no console error. Degrade
    // to the DOM tree through the error boundary instead of staying blank.
    function onContextLost() {
      failRenderer("webglcontextlost", new Error("WebGL context lost"));
    }
    canvas.addEventListener("webglcontextlost", onContextLost);
    const timer = window.setTimeout(() => {
      if (active) {
        const failure = new Error(
          `Pixi did not initialise within ${INIT_TIMEOUT_MS}ms`,
        );
        failRenderer("pixi.init", failure);
      }
    }, INIT_TIMEOUT_MS);
    // Pixi's own `resizeTo` only listens for window resizes, so a board that
    // changes size for any other reason (the detail panel opening, a layout
    // reflow, a font landing) keeps a stale drawing buffer and paints the wrong
    // slice of the scene - or nothing at all when it was measured at zero.
    function syncCanvasToHost() {
      applyCanvasFillStyle(canvas.style);
      const size = resizeRendererToHost(app.renderer, board);
      return size;
    }
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            if (!ready || !active) return;
            try {
              if (!syncCanvasToHost()) return;
            } catch (error) {
              failRenderer("pixi.resize", error);
              return;
            }
            renderNow();
            promptBlankWatch();
          });
    function onVisibilityChange() {
      if (document.visibilityState === "visible") {
        renderNow();
        promptBlankWatch();
      }
    }
    const initialSize = hostContentSize(board);
    const init = app.init({
      canvas,
      resizeTo: host,
      ...(initialSize
        ? { width: initialSize.width, height: initialSize.height }
        : {}),
      antialias: false,
      roundPixels: true,
      preference: "webgl",
      background: BOARD_BACKGROUND,
      resolution: resolveResolution(),
      // Without this Pixi leaves the canvas with no CSS size, so on a HiDPI
      // display its intrinsic device-pixel buffer becomes its layout size and
      // the slab paints at `resolution`x, clipped to the host's top-left corner.
      autoDensity: true,
    });
    let releaseProbe: (() => void) | null = null;
    void init.then(
      () => {
        if (!active) {
          dispose();
          return;
        }
        window.clearTimeout(timer);
        const world = new RelicWorld(app);
        worldRef.current = world;
        world.update(latestRef.current.tree);
        world.setCamera(latestRef.current.camera);
        world.setHoveredId(latestRef.current.hoveredId);
        ready = true;
        // The host may have been measured at zero (or have changed size) while
        // the pixi chunk was still loading; re-read it before the first frame
        // and force CSS fill so autoDensity cannot leave a stale inline size.
        try {
          syncCanvasToHost();
        } catch (error) {
          failRenderer("pixi.resize", error);
        }
        renderNow();
        renderNowRef.current = renderNow;
        app.ticker.add(() => {
          frames += 1;
        });
        observer?.observe(host);
        document.addEventListener("visibilitychange", onVisibilityChange);
        blankState = startBlankWatch(performance.now(), BLANK_WATCH_MS);
        promptBlankWatch();
        paintDeadline = window.setTimeout(() => {
          paintDeadline = null;
          if (!ready || !active || failed) return;
          if (blankState.phase === "stopped") return;
          applyBlankObservation("inconclusive");
        }, BLANK_WATCH_MS);
        releaseProbe = setRendererProbe(
          (): PixiFacts => ({
            isInitialised: ready,
            stageChildren: app.stage?.children.length ?? 0,
            worldBounds: boundsOf(app),
            camera: latestRef.current.camera,
            rendererType: rendererName(app),
            resolution: app.renderer?.resolution ?? 1,
            framesRendered: frames,
          }),
        );
      },
      (reason: unknown) => {
        dispose();
        if (!active) return;
        window.clearTimeout(timer);
        failRenderer("pixi.init", reason);
      },
    );
    return () => {
      active = false;
      ready = false;
      renderNowRef.current = null;
      releaseProbe?.();
      if (blankWatch !== null) cancelAnimationFrame(blankWatch);
      if (paintDeadline !== null) window.clearTimeout(paintDeadline);
      observer?.disconnect();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.clearTimeout(timer);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      worldRef.current?.destroy();
      worldRef.current = null;
      dispose();
      void init.then(dispose, dispose);
      canvas.remove();
    };
  }, []);

  useEffect(() => {
    worldRef.current?.update(tree);
    renderNowRef.current?.();
  }, [tree]);

  useEffect(() => {
    worldRef.current?.setCamera(camera);
    renderNowRef.current?.();
  }, [camera]);

  useEffect(() => {
    worldRef.current?.setHoveredId(hoveredId);
    renderNowRef.current?.();
  }, [hoveredId]);

  if (rendererFailure) throw rendererFailure;

  return <div className="tree-pixi-host" ref={hostRef} />;
}

function boundsOf(app: PixiApplication): PixiFacts["worldBounds"] {
  try {
    const bounds = app.stage?.getBounds();
    if (!bounds) return null;
    return {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
    };
  } catch {
    return null;
  }
}
