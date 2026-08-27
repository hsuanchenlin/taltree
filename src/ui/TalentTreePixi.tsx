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
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const worldRef = useRef<RelicWorld | null>(null);
  const [initFailure, setInitFailure] = useState<Error | null>(null);
  const latestRef = useRef({ tree, camera, hoveredId });
  latestRef.current = { tree, camera, hoveredId };

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const host = canvas.parentElement;
    if (!host) return;
    let active = true;
    const app = new PixiApplication();
    function dispose() {
      try {
        // React owns the canvas element. In development StrictMode the first
        // effect cleanup can finish after the replacement effect has mounted
        // against that same canvas, so Pixi must never remove the view.
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
      worldRef.current?.destroy();
      worldRef.current = null;
      dispose();
      void init.then(dispose, dispose);
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

  return (
    <div className="tree-pixi-host">
      <canvas ref={canvasRef} />
    </div>
  );
}
