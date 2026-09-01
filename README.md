# Taltree

A local-first planner for an overloaded day. You set a daily point budget, spend it on a directed talent tree, and see what each choice unlocks.

Unused budget expires at the next calendar day. Unfinished work stays. Missed days are not punished. There is no account, cloud, or AI.

Taltree comes in two builds that share the same rules:

- **Terminal** - a single Rust binary that draws the tree in character cells and is driven entirely from the keyboard, over a `tree.yaml` you own. See [`tui/README.md`](tui/README.md).
- **Web** - the browser build described below, over a plan stored in `localStorage`.

The terminal build reads and writes the same document, and imports a `tree.json` exported from the web build unchanged.

## Terminal build

Requires a stable Rust toolchain.

```bash
cd tui
cargo run                 # opens ./tree.yaml, or seeds a starter plan
cargo install --path .    # puts `taltree` on your PATH
```

Either installation route gives the same `taltree` command: the npm launcher
described below runs this binary too, building it on first use.

`hjkl` moves along the conduits, `c` completes, `d` defers, `a` adds, `r` links a prerequisite, `/` searches, `v` swaps to the list, and `?` shows every key. Full usage, the file format, and the socket glyphs are in [`tui/README.md`](tui/README.md).

## Web build: setup

Requires Node 20+.

```bash
npm install
npm run dev
```

Open the URL Vite prints (default [http://localhost:5173](http://localhost:5173)).

```bash
npm test          # domain, graph projection/layout, persistence, and tree markup tests
npm run typecheck
npm run lint
npm run build     # production bundle in dist/
npm run preview   # serve the production build locally
```

The app runs entirely in the browser. It does not start a backend and does not send plan data anywhere.

## Launcher CLI

Install once from this checkout to get the `taltree` command everywhere:

```bash
npm link        # or: npm install -g .
```

`npm link` is recommended: it keeps the command bound to this git checkout, which `taltree update` needs.

```bash
taltree                 # open ./tree.yaml in the terminal application
taltree plans/next.yaml # open a specific plan
taltree -e              # start empty instead of seeded with the demo
taltree -- --help       # the terminal application's own usage
taltree --web           # run the browser build's dev server and open it instead
taltree update          # git pull, rebuild and reinstall both builds
taltree update --check  # report whether an update exists, change nothing
taltree --help          # launcher usage
```

`taltree` runs the native terminal application, handing it the terminal directly so raw mode, keys, and colour behave exactly as they do under `cargo run`. The first launch compiles the release binary (a Rust toolchain is required); later launches start it straight away. The launcher claims only the arguments listed above and passes everything else - and everything after `--` - to the application unchanged, so its own options and plan paths need no escaping unless they collide with one of those.

`taltree update` fast-forwards this checkout, then rebuilds the terminal application, reinstalls it with `cargo install --path tui --force`, and reinstalls the browser build's dependencies. With `npm install -g .` the installed copy is not a git checkout, so `taltree update` prints re-install instructions instead of pulling.

### `taltree --web`

```bash
taltree --web --port 3000   # use a specific port (fails if it is busy)
taltree --web --no-open     # start without opening a browser (for headless or scripted use)
```

Press `q` or `Ctrl-C` to stop the server. The development server binds only to `127.0.0.1`; automatic port selection retries the next free port if another process wins the bind race.

If a previous run was killed outright (a closed terminal, a crashed shell) its dev server survives and keeps holding the port. `taltree --web` heals that on the next launch: it reads the pidfile it wrote under `.taltree/`, and when the process still holding the port is that orphaned server it stops it and takes the port back, reporting `taltree: reclaimed port 5173 from previous instance (pid 1234)`. Nothing else is ever signalled - a running server you started elsewhere, or any unrelated program on the port, is left alone. With automatic port selection the launcher moves to the next free port instead; an occupied explicit `--port` still fails.

## Usage

On first visit Taltree loads a demo plan, **A full Thursday**, so you can see a frontier that does not all fit in one day.

The **talent tree** is the main workspace: a dark relic slab of circular rune sockets, drawn with WebGL. Independent chains sit side by side; hard prerequisites sit above what they unlock as carved conduit channels. Each socket's rim, glyph, and plaque label all mark state (Eligible, Blocked, Deferred today, Completed), not colour alone. Machines without WebGL - or a browser where WebGL fails, loses its context, or does not confirm visible socket art within 800ms - automatically get the same tree as an SVG/DOM board, where node shape carries the state too. The view buttons above the board choose the renderer explicitly - **Relic tree** (WebGL), **Classic tree** (SVG/DOM), or **List** - and the choice is remembered in this browser, so a device where the relic slab draws badly can be moved to the classic tree for good.

1. Set **Daily budget** (points are your unit: hours, energy, or attention). Remaining budget stays visible on the tree and updates with spend.
2. Select a node on the tree. The strip above the board states the spend consequence; blocked nodes name the unfinished prerequisite; an eligible selection marks what **Unlocks next**.
3. The detail pane repeats **This choice**: cost, whether it fits remaining budget, **Immediately unlocks**, and **Still blocked after this**.
4. **Complete** spends the cost and refreshes remaining budget and the tree. **Defer today** keeps the node incomplete and off today's frontier until tomorrow (or until you return it).
5. **New node** / **Edit** set title, cost, and hard prerequisites. Directed cycles are rejected with the loop named.

Drag anywhere on the board to pan; a quick release continues with momentum. Scroll or pinch to smoothly zoom around the pointer or touch midpoint, and use `+` / `-` / `0` to zoom and fit. Double-click or double-tap a node to center it. Arrows move to a nearby node on the tree. `f` centers the selected node, and `v` toggles the list. Camera motion stops immediately when reduced motion is preferred.

Keyboard: `j` / `k` move in list order, arrows move on the tree, `f` centers the selected node, `c` completes, `d` defers, `u` undefer, `n` new node, `e` edit, `v` tree/list, `D` diagnostics, `?` help.

### Diagnostics

**Diagnostics** in the toolbar (or `D`) opens a read-only report of how this device is drawing the tree: WebGL support and version, the GPU vendor and renderer strings, the board, host, and canvas sizes against the device pixel ratio, Pixi's own state (initialised, stage children, world bounds, frames drawn, camera), the active renderer, plan and layout sizes, and the most recent captured errors and promise rejections. It leads with plain-language findings - a zero-sized drawing buffer, a canvas out of step with its container, a camera that has pushed the tree off the board.

**Copy diagnostics** puts the whole snapshot on the clipboard as JSON. A copy is also written to `localStorage` key `taltree.diagnostics.v1`, so it can be read back after a test session. Like everything else here, it stays on the device.

## Your data

The plan is a version 1 JSON document stored in this browser under `localStorage` key `taltree.plan.v1`. **Export JSON** downloads a copy. **Import JSON** replaces the local plan from a file you choose. Taltree never uploads it.

```json
{
  "version": 1,
  "title": "A full Thursday",
  "dailyBudget": 8,
  "activeDate": "2026-08-27",
  "spentToday": 0,
  "nodes": [
    {
      "id": "draft",
      "title": "Draft the project proposal",
      "cost": 3,
      "status": "open",
      "deferredOn": null,
      "completedOn": null,
      "prerequisiteIds": []
    }
  ]
}
```

`deferredOn` is the local `YYYY-MM-DD` the node was deferred. After that day it is eligible again if its prerequisites are done. Changing `activeDate` in the file is unnecessary: opening the app on a new day resets `spentToday` and expires leftover budget.

If a saved plan cannot be read, Taltree loads the demo instead but keeps the unreadable data on this device under `localStorage` key `taltree.plan.v1.broken` and offers **Download the unreadable file**, so nothing is lost. Importing a plan or loading the demo from the toolbar clears that backup.

## Scope (Slice 0)

This slice is the interactive talent tree, daily-budget ledger, and unlock explanations. It does not include syllabus import, Obsidian, LLM extraction, collaboration, accounts, XP, streaks, avatars, push notifications, or calendar auto-scheduling. The list/detail view remains as an accessible alternative; the product is not canvas-only.

Representative tree states used while building this slice are in [`docs/talent-tree/`](docs/talent-tree/).
