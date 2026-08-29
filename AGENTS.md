# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

## Commands

```bash
npm install
npm run dev
npm test
npm run typecheck
npm run lint
npm run build
```

Open the app at the Vite URL printed by `npm run dev` (default `http://localhost:5173`).

## Architecture

- Domain rules live in [`src/domain/plan.ts`](src/domain/plan.ts). Eligibility, cycle rejection, budget, unlock/block explanations, completion, defer, and rollover must stay there. The UI reads `inspect` and applies command results; it must not reimplement those rules.
- Talent-tree projection, layered layout, spatial neighbor lookup, and camera math (fit, zoom-about-a-point, keep-selection-visible, momentum/friction, smooth-zoom and focus lerping) live in [`src/graph/`](src/graph/). The tree UI reads `buildTalentTree`; it must not re-derive kinds or unlocks, and it must not reimplement camera geometry inline.
- The tree view renders through PixiJS (WebGL "relic slab"): [`src/ui/TalentTreePixi.tsx`](src/ui/TalentTreePixi.tsx) owns the lazily-loaded PixiJS `Application` lifecycle; [`src/canvas/world.ts`](src/canvas/world.ts) is the imperative scene that diffs `LaidOutGraph` snapshots by node id; [`src/canvas/skins.ts`](src/canvas/skins.ts) draws socket, glow, and halo art into live Pixi `Graphics` (no image assets, no `generateTexture`). Pure, Pixi-free helpers carry the renderer's unit tests: geometry/diff/hit-test in [`src/canvas/relicGeometry.ts`](src/canvas/relicGeometry.ts), radial-fill maths in [`src/canvas/radialFill.ts`](src/canvas/radialFill.ts), blank-board probing in [`src/canvas/blankBoard.ts`](src/canvas/blankBoard.ts), canvas-to-host sizing in [`src/canvas/canvasSize.ts`](src/canvas/canvasSize.ts). When WebGL is missing, init fails, or the context is lost, [`src/ui/TalentTree.tsx`](src/ui/TalentTree.tsx) falls back to the SVG/DOM world in [`src/ui/TalentTreeDomWorld.tsx`](src/ui/TalentTreeDomWorld.tsx) - keep that fallback working. Sharp edge: a canvas element holds exactly one WebGL context, so each mount creates its own canvas imperatively - never point two Pixi applications at one canvas, or a deferred destroy (StrictMode remount, fast refresh) kills the survivor's context and leaves a blank, error-free slab.
- Sharp edge - the silent slab: the relic renderer's worst failure mode is the one that raises nothing. Three rules keep it out of the scene, and they are load-bearing. The scene root must stay a plain container: a Pixi render group hands its subtree to the GPU as its own instruction set, and instructions that fail to rebuild leave the board painting nothing but its clear colour with no error anywhere. No skin may fill a `FillGradient` or bake through `generateTexture`: a gradient or a 0x0 texture both come back empty in silence. [`radialFill.ts`](src/canvas/radialFill.ts) stacks flat circles instead, and [`skins.ts`](src/canvas/skins.ts) paints those into live `Graphics`. The Pixi host sizes the canvas to `100%` of its host and calls `renderer.resize(host.clientWidth, host.clientHeight)` on mount and resize ([`canvasSize.ts`](src/canvas/canvasSize.ts)), then reads the drawing buffer back where a socket must be painted. Three blank readings fail the slab; so does an 800ms window with no confirmed paint, including inconclusive reads, so a black rectangle cannot persist. A working slab reports painted well inside that window.
- The renderer is a persisted, explicit choice (`relic` / `classic` / `list`, `localStorage` key `taltree.renderer.v1`) in [`src/ui/rendererPreference.ts`](src/ui/rendererPreference.ts), on top of the automatic WebGL fallback - a device where the slab paints black needs a way out that survives a reload.
- Diagnostics live in [`src/diagnostics/`](src/diagnostics/): [`snapshot.ts`](src/diagnostics/snapshot.ts) is the pure builder plus the findings that name a blank board, [`collect.ts`](src/diagnostics/collect.ts) does the browser measuring and holds the renderer probe the live Pixi host publishes into, and [`errorLog.ts`](src/diagnostics/errorLog.ts) is the captured-failure ring buffer. The panel is [`src/ui/DiagnosticsDialog.tsx`](src/ui/DiagnosticsDialog.tsx); every snapshot is also written to `localStorage` key `taltree.diagnostics.v1` so a tester's session can be read back afterwards.
- Sharp edge - the black board: Pixi's `resizeTo` only listens for *window* resizes, so any other container resize leaves a stale drawing buffer, and a host measured at zero stays zero forever. Both the Pixi host and the tree viewport therefore carry a `ResizeObserver`, the host sets the canvas to `100%` CSS and resizes the renderer to `host.clientWidth`/`clientHeight` on mount and resize, and it forces a direct `app.render()` after init, after a resize, on `visibilitychange`, and on every scene change, because a throttled `requestAnimationFrame` otherwise leaves the canvas showing nothing but its clear colour. Separately, every camera write funnels through `clampCameraToContent` ([`src/graph/camera.ts`](src/graph/camera.ts)) so no pan, glide, or resize can park the whole tree outside the board.
- The person-owned document is `Plan` in [`src/domain/types.ts`](src/domain/types.ts). Persistence is [`src/persist/storage.ts`](src/persist/storage.ts).
- The global `taltree` CLI (launch dev server + open browser; `taltree update` fast-forwards the checkout and reinstalls dependencies) lives in [`bin/taltree.mjs`](bin/taltree.mjs), plain ESM JavaScript so it runs without a build step. Pure parsing/port/status helpers in [`bin/lib/`](bin/lib/) carry the vitest tests (`bin/**/*.test.mjs`, included via `vite.config.ts`); keep CLI rules in those helpers, not inline in the entry. Sharp edge: `isPortFree` must probe both loopbacks and both wildcards (IPv4 plus IPv6-only) - BSD-style stacks let a wildcard bind coexist with a loopback-only listener on the same port, so probing `0.0.0.0` alone misses `127.0.0.1`-only squatters.
- Launcher process lifecycle is [`bin/lib/process.mjs`](bin/lib/process.mjs): a per-port pidfile under `.taltree/` records the launcher and its Vite child, and `reclaimPort` frees a port still held by an orphan of this installation. Two rules keep it from killing the wrong thing, and both are load-bearing: the *server* is identified by a command line that is under the install root **and** named like vite/taltree (the root alone matches `postgres -D <root>/data`), and stale-vs-live is decided by *parentage* - a server whose parent is still its recorded launcher is in use, one reparented to init is the orphan. Never identify the launcher by its command line: it is invoked by a relative path or through a global shim outside the root.
- Domain language: [`CONTEXT.md`](CONTEXT.md). Local-first decision: [`docs/adr/0001-local-first-json.md`](docs/adr/0001-local-first-json.md).
- Setup and usage: [`README.md`](README.md). The talent tree is the primary workspace; keep the list/detail view as the accessible keyboard-operable alternative.

## Product constraints (do not regress)

- No accounts, telemetry, cloud backend, AI, streaks, XP, avatars, or punishment for missed days.
- Unused daily budget expires; unfinished work rolls forward; defer is for the current local calendar day only.
- Reject directed cycles with a path explanation. Keep a list/detail UI; do not replace it with a canvas-only graph.
- Never upload plan data.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
