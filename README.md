# Taltree

A local-first web planner for an overloaded day. You set a daily point budget, spend it on a dependency graph, and see what each choice unlocks.

Unused budget expires at the next calendar day. Unfinished work stays. Missed days are not punished. There is no account, cloud, or AI.

## Setup

Requires Node 20+.

```bash
npm install
npm run dev
```

Open the URL Vite prints (default [http://localhost:5173](http://localhost:5173)).

```bash
npm test          # domain and persistence tests
npm run typecheck
npm run lint
npm run build     # production bundle in dist/
npm run preview   # serve the production build locally
```

The app runs entirely in the browser. It does not start a backend and does not send plan data anywhere.

## Usage

On first visit Taltree loads a demo plan, **A full Thursday**, so you can see a frontier that does not all fit in one day.

1. Set **Daily budget** (points are your unit: hours, energy, or attention).
2. The **Frontier** lists eligible work: open, not deferred today, with every hard prerequisite completed.
3. Select a node to read **This choice**: cost, whether it fits remaining budget, **Immediately unlocks**, and **Still blocked after this** with the direct remaining prerequisite.
4. **Complete** spends the cost and refreshes remaining budget and the frontier. **Defer today** keeps the node incomplete and hides it until tomorrow (or until you return it).
5. **New node** / **Edit** set title, cost, and hard prerequisites. Directed cycles are rejected with the loop named.

Keyboard: `j` / `k` or arrows move, `c` completes, `d` defers, `u` undefer, `n` new node, `e` edit, `?` help. Status uses a glyph plus a word (Eligible, Blocked, Deferred today, Completed), not colour alone.

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

This slice is the daily-budget graph and unlock explanations. It does not include syllabus import, Obsidian, LLM extraction, collaboration, accounts, XP, streaks, avatars, push notifications, or calendar auto-scheduling.
