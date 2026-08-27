import { Application } from "@pixi/react";
import type { Application as PixiApplication } from "pixi.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { isRendererInitFailure } from "../canvas/webgl";
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
}

/**
 * `@pixi/react` awaits `app.init()` inside a layout effect and never catches
 * it, so a rejected init would silently leave a blank slab forever. We watch
 * for the rejection and, as a backstop, for an init that simply never lands,
 * then rethrow during render so `PixiErrorBoundary` swaps in the DOM world.
 *
 * A rejection only demotes the slab if it looks like a renderer failure and
 * the stage is still uninitialised after a grace period, so a stray rejection
 * that merely races a healthy init cannot cost the user the WebGL renderer.
 */
const INIT_TIMEOUT_MS = 10_000;
const INIT_GRACE_MS = 750;

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

export default function TalentTreePixi({ tree, camera }: TalentTreePixiProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<RelicWorld | null>(null);
  const initialisedRef = useRef(false);
  const [initialised, setInitialised] = useState(false);
  const [initFailure, setInitFailure] = useState<Error | null>(null);
  const latestRef = useRef({ tree, camera });
  latestRef.current = { tree, camera };

  const handleInit = useCallback((app: PixiApplication) => {
    initialisedRef.current = true;
    const world = new RelicWorld(app);
    worldRef.current = world;
    world.update(latestRef.current.tree);
    world.setCamera(latestRef.current.camera);
    setInitialised(true);
  }, []);

  useEffect(() => {
    if (initialised) return;
    const timers: number[] = [];
    function fail(reason: unknown) {
      if (initialisedRef.current) return;
      setInitFailure(
        reason instanceof Error ? reason : new Error(String(reason)),
      );
    }
    function onRejection(event: PromiseRejectionEvent) {
      if (initialisedRef.current) return;
      if (!isRendererInitFailure(event.reason)) return;
      const { reason } = event;
      timers.push(window.setTimeout(() => fail(reason), INIT_GRACE_MS));
    }
    timers.push(
      window.setTimeout(() => {
        fail(new Error(`Pixi did not initialise within ${INIT_TIMEOUT_MS}ms`));
      }, INIT_TIMEOUT_MS),
    );
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, [initialised]);

  useEffect(() => {
    return () => {
      worldRef.current?.destroy();
      worldRef.current = null;
    };
  }, []);

  useEffect(() => {
    worldRef.current?.update(tree);
  }, [tree]);

  useEffect(() => {
    worldRef.current?.setCamera(camera);
  }, [camera]);

  if (initFailure) throw initFailure;

  return (
    <div ref={hostRef} className="tree-pixi-host">
      <Application
        resizeTo={hostRef}
        antialias={false}
        roundPixels
        preference="webgl"
        background={0x0c1016}
        resolution={resolveResolution()}
        onInit={handleInit}
      />
    </div>
  );
}
