import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { demoPlan } from "../demo/seed";
import { frozenClock } from "../domain/clock";
import {
  completeNode,
  deferNode,
  explainChoice,
  inspect,
} from "../domain/plan";
import { buildTalentTree } from "../graph";
import { TalentTree } from "./TalentTree";

const clock = frozenClock("2026-08-27");

describe("TalentTree markup", () => {
  it("renders a node, a prerequisite edge, and state attributes for the demo plan", () => {
    const view = inspect(demoPlan(), clock);
    const explained = explainChoice(view.plan, "grocery", clock);
    const unlockIds = explained.ok
      ? explained.value.immediateUnlocks.map((ref) => ref.id)
      : [];
    const tree = buildTalentTree(view, {
      selectedId: "grocery",
      immediateUnlockIds: unlockIds,
    });
    const html = renderToStaticMarkup(
      createElement(TalentTree, {
        tree,
        remaining: view.remaining,
        explanation: explained.ok ? explained.value : null,
        onSelect: () => undefined,
      }),
    );

    expect(html).toContain('data-node-id="grocery"');
    expect(html).toContain('data-kind="eligible"');
    expect(html).toContain('data-selected="true"');
    expect(html).toContain('data-node-id="cook"');
    expect(html).toContain('data-unlocks="true"');
    expect(html).toContain('data-edge="grocery-&gt;cook"');
    expect(html).toContain('data-edge-kind="unlock"');
    expect(html).toContain('data-kind="blocked"');
    expect(html).toContain("Waiting on");
    expect(html).toContain("Unlocks next");
    expect(html).toContain("8 points remaining");
    expect(html).toContain("Immediately unlocks Cook dinner");
  });

  it("distinguishes completed and deferred nodes after domain commands", () => {
    let plan = inspect(demoPlan(), clock).plan;
    plan = must(completeNode(plan, "school", clock));
    plan = must(deferNode(plan, "walk", clock));
    const view = inspect(plan, clock);
    const tree = buildTalentTree(view, { selectedId: "school", immediateUnlockIds: [] });
    const html = renderToStaticMarkup(
      createElement(TalentTree, {
        tree,
        remaining: view.remaining,
        explanation: null,
        onSelect: () => undefined,
      }),
    );
    expect(html).toMatch(/data-node-id="school"[^>]*data-kind="completed"/);
    expect(html).toMatch(/data-node-id="walk"[^>]*data-kind="deferred"/);
    expect(html).toContain("Eligible");
    expect(html).toContain("Blocked");
    expect(html).toContain("Deferred today");
    expect(html).toContain("Completed");
  });
});

function must<T>(result: { ok: true; value: T } | { ok: false; error: { message: string } }): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}
