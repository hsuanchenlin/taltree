import { Application } from "@pixi/react";
import type { Application as PixiApplication } from "pixi.js";
import { useCallback, useEffect, useRef } from "react";
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
  const latestRef = useRef({ tree, camera });
  latestRef.current = { tree, camera };

  const handleInit = useCallback((app: PixiApplication) => {
    const world = new RelicWorld(app);
    worldRef.current = world;
    world.update(latestRef.current.tree);
    world.setCamera(latestRef.current.camera);
  }, []);

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
