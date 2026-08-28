import { Application as PixiApplication } from "pixi.js";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { RelicWorld } from "../canvas/world";
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

export default function TalentTreePixi({
  tree,
  camera,
  hoveredId,
}: TalentTreePixiProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<RelicWorld | null>(null);
  const [initFailure, setInitFailure] = useState<Error | null>(null);
  const latestRef = useRef({ tree, camera, hoveredId });
  latestRef.current = { tree, camera, hoveredId };

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let active = true;
    // The effect owns its canvas, not React. A canvas element holds exactly one
    // WebGL context, so under StrictMode's mount-cleanup-mount (or a fast
    // refresh) the first application's deferred destroy would otherwise kill
    // the context its replacement is already rendering with - the blank,
    // error-free slab this guards against.
    const canvas = document.createElement("canvas");
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
    // A lost context presents as a blank slab with no console error. Degrade
    // to the DOM tree through the error boundary instead of staying blank.
    function onContextLost() {
      if (active) {
        setInitFailure(new Error("WebGL context lost"));
      }
    }
    canvas.addEventListener("webglcontextlost", onContextLost);
    const timer = window.setTimeout(() => {
      if (active) {
        setInitFailure(
          new Error(`Pixi did not initialise within ${INIT_TIMEOUT_MS}ms`),
        );
      }
    }, INIT_TIMEOUT_MS);
    const init = app.init({
      canvas,
      resizeTo: host,
      antialias: false,
      roundPixels: true,
      preference: "webgl",
      background: 0x0c1016,
      resolution: resolveResolution(),
      // Without this Pixi leaves the canvas with no CSS size, so on a HiDPI
      // display its intrinsic device-pixel buffer becomes its layout size and
      // the slab paints at `resolution`x, clipped to the host's top-left corner.
      autoDensity: true,
    });
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
      },
      (reason: unknown) => {
        dispose();
        if (!active) return;
        window.clearTimeout(timer);
        setInitFailure(
          reason instanceof Error ? reason : new Error(String(reason)),
        );
      },
    );
    return () => {
      active = false;
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
  }, [tree]);

  useEffect(() => {
    worldRef.current?.setCamera(camera);
  }, [camera]);

  useEffect(() => {
    worldRef.current?.setHoveredId(hoveredId);
  }, [hoveredId]);

  if (initFailure) throw initFailure;

  return <div className="tree-pixi-host" ref={hostRef} />;
}
