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
- The tree view renders through PixiJS (WebGL "relic slab"): [`src/ui/TalentTreePixi.tsx`](src/ui/TalentTreePixi.tsx) owns the lazily-loaded PixiJS `Application` lifecycle; [`src/canvas/world.ts`](src/canvas/world.ts) is the imperative scene that diffs `LaidOutGraph` snapshots by node id; [`src/canvas/skins.ts`](src/canvas/skins.ts) bakes all socket art procedurally (no image assets). Pure, Pixi-free geometry/diff/hit-test helpers live in [`src/canvas/relicGeometry.ts`](src/canvas/relicGeometry.ts) and carry the renderer's unit tests. When WebGL is missing or init fails, [`src/ui/TalentTree.tsx`](src/ui/TalentTree.tsx) falls back to the SVG/DOM world in [`src/ui/TalentTreeDomWorld.tsx`](src/ui/TalentTreeDomWorld.tsx) - keep that fallback working. Sharp edge: under `npm run dev` the Pixi canvas can end up with a lost WebGL context (empty white viewport, no console error); the production build renders fine, so verify canvas work against `npm run build` + `vite preview`.
- The person-owned document is `Plan` in [`src/domain/types.ts`](src/domain/types.ts). Persistence is [`src/persist/storage.ts`](src/persist/storage.ts).
- The global `taltree` CLI (launch dev server + open browser; `taltree update` fast-forwards the checkout and reinstalls dependencies) lives in [`bin/taltree.mjs`](bin/taltree.mjs), plain ESM JavaScript so it runs without a build step. Pure parsing/port/status helpers in [`bin/lib/`](bin/lib/) carry the vitest tests (`bin/**/*.test.mjs`, included via `vite.config.ts`); keep CLI rules in those helpers, not inline in the entry. Sharp edge: `isPortFree` must probe both loopbacks and both wildcards (IPv4 plus IPv6-only) - BSD-style stacks let a wildcard bind coexist with a loopback-only listener on the same port, so probing `0.0.0.0` alone misses `127.0.0.1`-only squatters.
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
