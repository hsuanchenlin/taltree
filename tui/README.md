# Taltree TUI

The talent tree as a single-binary terminal application: the same plan, the same
rules, drawn in character cells and driven from the keyboard.

```bash
cd tui
cargo run                      # opens ./tree.yaml, or seeds a starter plan
cargo run -- ~/plans/week.yaml
cargo install --path .         # installs the internal `taltree-tui` binary
```

## Opening a plan

```
taltree-tui [OPTIONS] [PATH]
```

With no `PATH` the first of these that exists wins, and when none does the plan
starts at `./tree.yaml`:

1. The active plan set by `taltree load` (the path in `$XDG_CONFIG_HOME/taltree/active`)
2. `./tree.yaml`, `./tree.yml`, `./tree.json`
3. `$XDG_CONFIG_HOME/taltree/tree.yaml` (or `~/.config/taltree/tree.yaml`)

An explicit path on the command line always wins over the active plan. A pointer
at a file that is no longer there falls through to the ordinary search.

A `.json` path is read and written as JSON, so a plan exported from the web
build opens unchanged. When a YAML path is requested explicitly but is missing,
a sibling `.json` file is imported and the first save writes the requested YAML.

| Option | |
| --- | --- |
| `-e`, `--empty` | start a new plan empty instead of seeded with the demo |
| `--date <DAY>` | treat `YYYY-MM-DD` as today, for trying out rollover |
| `-h`, `--help` | usage |
| `-V`, `--version` | version |

## The screen

```
Budget: [██████░░░░░░] 4/8 remaining (4 spent) · 2 of 16 unlocked · 2026-08-31
┌ the board ───────────────────────────────┐┌ Inspector ──────────┐
│ ( ) Find last year's…  2                 ││ Finish the tax packet
│              ║                           ││ [ ] Blocked · 5 points
│ [ ] Finish the tax p…  5                 ││ Needs / Unlocks / Notes
└──────────────────────────────────────────┘└─────────────────────┘
hjkl move · c complete · d defer · a add · e edit · r link · … · ? help · q quit
```

Prerequisites sit above what they unlock, joined by orthogonal conduits. A
conduit whose prerequisite is completed is drawn illuminated (`═ ║ ╠`) instead
of plain (`─ │ ├`).

| Socket | |
| --- | --- |
| `( )` | eligible: every prerequisite is done |
| `[*]` | completed |
| `[ ]` | blocked: something it needs is unfinished |
| `[-]` | deferred for today |

Press `?` inside the application for the full keybinding sheet. `z` swaps
between one-row chips and three-row boxes; `v` swaps between the tree and the
keyboard-operable list.

## The file

Plans are YAML a person can read and edit:

```yaml
# Taltree plan. Edit by hand if you like: ids are stable references,
# dates are YYYY-MM-DD, and costs are whole points.
version: 1
title: A full Thursday
dailyBudget: 8
activeDate: 2026-08-31
spentToday: 2
nodes:
- id: find-receipts
  title: Find last year's receipts
  group: Paperwork
  cost: 2
  status: completed
  completedOn: 2026-08-31
- id: tax-packet
  title: Finish the tax packet
  cost: 5
  status: open
  prerequisiteIds:
  - find-receipts
```

A node may also carry an optional `group` string, which files it in a named
section of the list. Group headers are non-interactive separator rows; grouping
never changes eligibility, budget, or unlocks. Existing plans without `group`
draw exactly as they did.

A node may also carry a free-text `notes` field. Typed resource links live in
those notes, not in a separate schema: a line
`- [@article@The Internet](https://en.wikipedia.org/wiki/Internet)` is shown as
an `article` tag and a title link. Types are `official`, `opensource`,
`article`, `course`, `podcast`, `video`, `book`, and `feed`. Keep at most eight,
and keep the ones most relevant today rather than the biggest list. Content is
keyed by node id, so renaming a title does not lose it. Press `M` to file the
selection into a group, or `:group <label>` from the command line.

Every change saves itself, through a temporary file renamed into place, so an
interrupted save leaves the previous plan intact. Nothing is uploaded anywhere.

## Working on it

```bash
cargo test                             # domain, layout, conduits, keys, and screens
cargo clippy --all-targets -- -D warnings
cargo fmt
cargo run --example board_preview 96   # print the demo board as text
```

Architecture notes live in the repository's [`AGENTS.md`](../AGENTS.md).
