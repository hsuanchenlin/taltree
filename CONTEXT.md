# Taltree

A local-first daily-budget planner. The person spends a limited daily budget on a dependency graph and sees what each choice unlocks.

## Language

**Plan**:
The person's collection of nodes, hard prerequisites, and the current day's budget ledger. Stored as a versioned JSON document the person owns.
_Avoid_: Project, board, workspace, graph document

**Node**:
A single piece of work with a title, a point cost, and a status of open or completed.
_Avoid_: Task, ticket, card, item, todo

**Cost**:
The integer point estimate required to complete a node. Points are the person's own unit (hours, energy, attention).
_Avoid_: Story points, XP, weight, duration

**Hard prerequisite**:
A directed dependency: the prerequisite node must be completed before the dependent node is eligible. Cycles are forbidden.
_Avoid_: Soft dependency, blocker link, related to

**Daily budget**:
The number of points the person is willing to spend today. Unused points expire when the calendar day changes.
_Avoid_: Quota, allowance, energy bar, streak goal

**Remaining budget**:
Daily budget minus points spent completing nodes today, never shown below zero.
_Avoid_: Health, mana, score

**Frontier**:
The eligible nodes for today: open, not deferred today, with every hard prerequisite completed.
_Avoid_: Backlog, sprint, queue, inbox zero

**Eligible**:
A node that can be started now because its hard prerequisites are done and it is not deferred today.
_Avoid_: Ready, unblocked (as the stored status), available

**Blocked**:
A node that still has at least one unfinished hard prerequisite.
_Avoid_: Waiting (as the kind name), stuck, on hold

**Direct reason**:
The unfinished hard prerequisites that currently block a node, named by title.
_Avoid_: Root cause, critical path (for this explanation)

**Immediate unlock**:
A still-open dependent that would become eligible if the selected node were completed now.
_Avoid_: Side effect, cascade, reward

**Defer**:
An explicit choice to keep a node incomplete but off today's frontier. Deferral is for one calendar day.
_Avoid_: Snooze, skip, pause forever, won't do

**Rollover**:
Unfinished work (open or previously deferred) remains in the plan after a missed or ended day. Deferred-yesterday nodes can be eligible again. Unused budget does not roll over.
_Avoid_: Carry-over points, streak freeze, penalty waiver

**Missed day**:
A calendar day with no completions. Unused budget expires; nothing is punished.
_Avoid_: Broken streak, fail day, debt

**Group**:
An optional label on a node that files it in a named section of the list. Grouping is presentation, never scheduling: it does not change eligibility, budget, or what unlocks what.
_Avoid_: Tag, folder, epic, category (as a scheduling construct)
