import { createRoot } from "@pixi/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { RelicWorld } from "../canvas/world";
import type { Camera, LaidOutGraph } from "../graph";

/**
 * The WebGL relic-slab stage. Loaded lazily from `TalentTree` so first paint
 * and the list view never wait on the pixi chunk. `@pixi/react` owns the
 * Application lifecycle only; the scene itself is the imperative `RelicWorld`.
 */

interface TalentTreePixiProps {
  tree: LaidOutGraph;
  camera: Camera;
  hoveredId: string | null;
}

/**
 * The public root API returns the exact render promise that owns `app.init()`.
 * Catching that promise keeps failure handling scoped to this canvas instead
 * of inferring ownership from page-global rejection text.
 */
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
    let active = true;
    const timer = window.setTimeout(() => {
      if (active) {
        setInitFailure(
          new Error(`Pixi did not initialise within ${INIT_TIMEOUT_MS}ms`),
        );
      }
    }, INIT_TIMEOUT_MS);
    const root = createRoot(canvas, {
      onInit(app) {
        if (!active) return;
        window.clearTimeout(timer);
        const world = new RelicWorld(app);
        worldRef.current = world;
        world.update(latestRef.current.tree);
        world.setCamera(latestRef.current.camera);
        world.setHoveredId(latestRef.current.hoveredId);
      },
    });
    const init = root.render(null, {
      resizeTo: canvas.parentElement,
      antialias: false,
      roundPixels: true,
      preference: "webgl",
      background: 0x0c1016,
      resolution: resolveResolution(),
    }) as Promise<unknown>;
    void init.catch((reason: unknown) => {
      if (!active) return;
      window.clearTimeout(timer);
      setInitFailure(
        reason instanceof Error ? reason : new Error(String(reason)),
      );
    });
    return () => {
      active = false;
      window.clearTimeout(timer);
      worldRef.current?.destroy();
      worldRef.current = null;
      const app = root.applicationState.app;
      if (root.applicationState.isInitialised) app.destroy(true);
      else void init.then(() => app.destroy(true), () => undefined);
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
