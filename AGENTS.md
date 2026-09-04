# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

## Commands

Two builds share this repository and are checked separately in CI.

Terminal application (Rust, in [`tui/`](tui/)):

```bash
cd tui
cargo test
cargo clippy --all-targets -- -D warnings
cargo fmt
cargo run                              # opens ./tree.yaml
cargo run --example board_preview 96   # print the demo board as text
```

Web application (TypeScript, at the repository root):

```bash
npm install
npm run dev
npm test
npm run typecheck
npm run lint
npm run build
```

Open the web app at the Vite URL printed by `npm run dev` (default `http://localhost:5173`).

## Architecture: terminal application (`tui/`)

- The same rules as the web build, ported and owned separately: [`tui/src/domain/plan.rs`](tui/src/domain/plan.rs) holds eligibility, cycle rejection, budget, unlock/block explanations, completion, defer, and rollover, and every command takes a plan by reference and returns a new one so a refused command cannot half-change the document. The UI reads `inspect` and applies results; it never re-derives a rule. Nothing in the crate asks the calendar directly - every rule takes a `&dyn Clock` ([`clock.rs`](tui/src/domain/clock.rs)), which is how a test walks a plan past midnight.
- The person-owned document is `tree.yaml` ([`tui/src/persist/`](tui/src/persist/)): serde field names are the camelCase spelling the web build's JSON already uses, so a `tree.json` imports unchanged and a `.json` path stays JSON. [`validate.rs`](tui/src/persist/validate.rs) runs on every load because the file is hand-editable. Sharp edge: dates are compared as strings everywhere, so `validate` rewrites a hand-written `2026-8-31` to `2026-08-31` - without that, a deferral would silently never match today. Saves go through a temporary file renamed into place ([`store.rs`](tui/src/persist/store.rs)). Optional node `notes` are shared with the web build. Typed resource links are a notes-line convention parsed by [`notes.rs`](tui/src/domain/notes.rs), not a schema field - do not vendor curriculum text into the repo. Optional node `group` is presentation only (list headers); it must not affect eligibility. With no path, the TUI opens the active plan at `$XDG_CONFIG_HOME/taltree/active` before `./tree.yaml`.
- The board is built as data, not painted: [`tui/src/graph/layout.rs`](tui/src/graph/layout.rs) is a layered (Sugiyama) layout in cell coordinates, [`conduit.rs`](tui/src/graph/conduit.rs) merges direction bits into box-drawing glyphs, and [`board.rs`](tui/src/graph/board.rs) composes conduits and node chips into a grid of `(char, Ink)` the renderer only has to colour. That is what lets layout and drawing be asserted as text.
- Sharp edge - two axes, two rules: an edge spanning more than one rank gets dummy slots so its conduit has reserved space instead of running through whatever node is in the way, and `settle` places a rank by isotonic regression rather than greedy left-packing. Packing greedily shoves a pair of prerequisites to one side of the dependent they share, and the next sweep chases them, so the layout never converges. Separately, `j`/`k` pick the nearest *rank* and `h`/`l` the nearest node on the *same row* ([`navigate.rs`](tui/src/graph/navigate.rs)): one weighting for both axes makes `l` jump to the parent above.
- Sharp edge - cell width is not character count: a double-width character claims two terminal columns, so [`board.rs`](tui/src/graph/board.rs) writes a `CONTINUATION` marker into the second cell and `to_lines` drops it. Without that a CJK title silently shifts every chip on its row.
- Keys are a pure function of mode and key event ([`tui/src/ui/keys.rs`](tui/src/ui/keys.rs)) producing an `Action` that [`app.rs`](tui/src/ui/app.rs) applies, so the whole keyboard is testable without a terminal. Modes and the shared text input live in [`mode.rs`](tui/src/ui/mode.rs). [`render.rs`](tui/src/ui/render.rs) is only geometry and colour.
- Tests: unit tests sit beside their module; [`tui/tests/session.rs`](tui/tests/session.rs) drives key sequences and reads the plan back off disk, and [`tui/tests/screen.rs`](tui/tests/screen.rs) renders into ratatui's `TestBackend` and asserts the screen as text. A change that works on screen but never reaches the file fails the first; a truncated panel fails the second.

## Architecture: web application (repository root)

- Domain rules live in [`src/domain/plan.ts`](src/domain/plan.ts). Eligibility, cycle rejection, budget, unlock/block explanations, completion, defer, and rollover must stay there. The UI reads `inspect` and applies command results; it must not reimplement those rules.
- Talent-tree projection, layered layout, spatial neighbor lookup, and camera math (fit, zoom-about-a-point, keep-selection-visible, momentum/friction, smooth-zoom and focus lerping) live in [`src/graph/`](src/graph/). The tree UI reads `buildTalentTree`; it must not re-derive kinds or unlocks, and it must not reimplement camera geometry inline.
- The tree view renders through PixiJS (WebGL "relic slab"): [`src/ui/TalentTreePixi.tsx`](src/ui/TalentTreePixi.tsx) owns the lazily-loaded PixiJS `Application` lifecycle; [`src/canvas/world.ts`](src/canvas/world.ts) is the imperative scene that diffs `LaidOutGraph` snapshots by node id; [`src/canvas/skins.ts`](src/canvas/skins.ts) draws socket, glow, and halo art into live Pixi `Graphics` (no image assets, no `generateTexture`). Pure, Pixi-free helpers carry the renderer's unit tests: geometry/diff/hit-test in [`src/canvas/relicGeometry.ts`](src/canvas/relicGeometry.ts), radial-fill maths in [`src/canvas/radialFill.ts`](src/canvas/radialFill.ts), blank-board probing in [`src/canvas/blankBoard.ts`](src/canvas/blankBoard.ts), canvas-to-host sizing in [`src/canvas/canvasSize.ts`](src/canvas/canvasSize.ts). When WebGL is missing, init fails, or the context is lost, [`src/ui/TalentTree.tsx`](src/ui/TalentTree.tsx) falls back to the SVG/DOM world in [`src/ui/TalentTreeDomWorld.tsx`](src/ui/TalentTreeDomWorld.tsx) - keep that fallback working. Sharp edge: a canvas element holds exactly one WebGL context, so each mount creates its own canvas imperatively - never point two Pixi applications at one canvas, or a deferred destroy (StrictMode remount, fast refresh) kills the survivor's context and leaves a blank, error-free slab.
- Sharp edge - the silent slab: the relic renderer's worst failure mode is the one that raises nothing. Three rules keep it out of the scene, and they are load-bearing. The scene root must stay a plain container: a Pixi render group hands its subtree to the GPU as its own instruction set, and instructions that fail to rebuild leave the board painting nothing but its clear colour with no error anywhere. No skin may fill a `FillGradient` or bake through `generateTexture`: a gradient or a 0x0 texture both come back empty in silence. [`radialFill.ts`](src/canvas/radialFill.ts) stacks flat circles instead, and [`skins.ts`](src/canvas/skins.ts) paints those into live `Graphics`. The Pixi host sizes the canvas to `100%` of its host and calls `renderer.resize(host.clientWidth, host.clientHeight)` on mount and resize ([`canvasSize.ts`](src/canvas/canvasSize.ts)), then reads the drawing buffer back where a socket must be painted. Three blank readings fail the slab; so does an 800ms window with no confirmed paint, including inconclusive reads, so a black rectangle cannot persist. A working slab reports painted well inside that window.
- The renderer is a persisted, explicit choice (`relic` / `classic` / `list`, `localStorage` key `taltree.renderer.v1`) in [`src/ui/rendererPreference.ts`](src/ui/rendererPreference.ts), on top of the automatic WebGL fallback - a device where the slab paints black needs a way out that survives a reload.
- Diagnostics live in [`src/diagnostics/`](src/diagnostics/): [`snapshot.ts`](src/diagnostics/snapshot.ts) is the pure builder plus the findings that name a blank board, [`collect.ts`](src/diagnostics/collect.ts) does the browser measuring and holds the renderer probe the live Pixi host publishes into, and [`errorLog.ts`](src/diagnostics/errorLog.ts) is the captured-failure ring buffer. The panel is [`src/ui/DiagnosticsDialog.tsx`](src/ui/DiagnosticsDialog.tsx); every snapshot is also written to `localStorage` key `taltree.diagnostics.v1` so a tester's session can be read back afterwards.
- Sharp edge - the black board: Pixi's `resizeTo` only listens for *window* resizes, so any other container resize leaves a stale drawing buffer, and a host measured at zero stays zero forever. Both the Pixi host and the tree viewport therefore carry a `ResizeObserver`, the host sets the canvas to `100%` CSS and resizes the renderer to `host.clientWidth`/`clientHeight` on mount and resize, and it forces a direct `app.render()` after init, after a resize, on `visibilitychange`, and on every scene change, because a throttled `requestAnimationFrame` otherwise leaves the canvas showing nothing but its clear colour. Separately, every camera write funnels through `clampCameraToContent` ([`src/graph/camera.ts`](src/graph/camera.ts)) so no pan, glide, or resize can park the whole tree outside the board.
- The person-owned document is `Plan` in [`src/domain/types.ts`](src/domain/types.ts). Persistence is [`src/persist/storage.ts`](src/persist/storage.ts). Optional node `notes` round-trip with the TUI; typed resource links are parsed from notes lines by [`src/domain/notes.ts`](src/domain/notes.ts) and must not become a schema field. Optional node `group` is list presentation only. The browser takes up the plan `taltree load` made active once per switch via [`src/persist/activePlan.ts`](src/persist/activePlan.ts) and the dev-only route in [`vite/activePlanPlugin.mjs`](vite/activePlanPlugin.mjs); it must not re-read the file on every reload or browser edits are lost.
- The global `taltree` CLI lives in [`bin/taltree.mjs`](bin/taltree.mjs), plain ESM JavaScript so it runs without a build step. Pure parsing/port/status helpers in [`bin/lib/`](bin/lib/) carry the vitest tests (`bin/**/*.test.mjs`, included via `vite.config.ts`); keep CLI rules in those helpers, not inline in the entry. `taltree import <slug>` fetches `https://roadmap.sh/api/v1-official-roadmap/<slug>` on demand and writes titles, ids, drawn edges, and section groups to `~/.config/taltree/plans/<slug>.yaml` - never roadmap.sh topic text, which is all-rights-reserved and must not be bundled. The converter is [`bin/lib/roadmap.mjs`](bin/lib/roadmap.mjs); the library is [`bin/lib/plans.mjs`](bin/lib/plans.mjs). Sharp edge: `isPortFree` must probe both loopbacks and both wildcards (IPv4 plus IPv6-only) - BSD-style stacks let a wildcard bind coexist with a loopback-only listener on the same port, so probing `0.0.0.0` alone misses `127.0.0.1`-only squatters.
- `taltree` runs the *terminal* application; the dev server is only `taltree --web`, and `taltree update` rebuilds and reinstalls both. [`bin/lib/tui.mjs`](bin/lib/tui.mjs) owns that: it builds `tui/target/release/taltree-tui` on first use and spawns it with `stdio: "inherit"`, which is what lets the Rust side hold raw mode, read keys, and paint ANSI - pipe any of the three and it draws into a buffer nobody sees. Cargo installs the native target as `taltree-tui` so it cannot shadow the public Node launcher. Two rules follow from the launcher being a wrapper, not a second command line: it claims only the arguments it can act on and forwards the rest (and everything after `--`) untouched, because [`tui/src/cli.rs`](tui/src/cli.rs) is the authority on its own options; and it stops reacting to SIGINT while the application runs, since in raw mode Ctrl-C is a key event and a launcher dying on it would leave the terminal in raw mode on the alternate screen.
- Launcher process lifecycle is [`bin/lib/process.mjs`](bin/lib/process.mjs): a per-port pidfile under `.taltree/` records the launcher and its Vite child, and `reclaimPort` frees a port still held by an orphan of this installation. Two rules keep it from killing the wrong thing, and both are load-bearing: the *server* is identified by a command line that is under the install root **and** named like vite/taltree (the root alone matches `postgres -D <root>/data`), and stale-vs-live is decided by *parentage* - a server whose parent is still its recorded launcher is in use, one reparented to init is the orphan. Never identify the launcher by its command line: it is invoked by a relative path or through a global shim outside the root.
- Domain language: [`CONTEXT.md`](CONTEXT.md). Local-first decision: [`docs/adr/0001-local-first-json.md`](docs/adr/0001-local-first-json.md).
- Setup and usage: [`README.md`](README.md) and [`tui/README.md`](tui/README.md). In both builds the talent tree is the primary workspace; keep the list view as the accessible keyboard-operable alternative.

## Product constraints (do not regress)

- No accounts, telemetry, cloud backend, AI, streaks, XP, avatars, or punishment for missed days.
- Unused daily budget expires; unfinished work rolls forward; defer is for the current local calendar day only.
- Reject directed cycles with a path explanation. Keep a list/detail UI in both builds; do not replace it with a graph-only view.
- Never upload plan data.
- Never bundle roadmap.sh content; import is an on-demand personal fetch only.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
