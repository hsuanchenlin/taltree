import { describe, expect, it } from "vitest";
import type { NodeListing } from "../domain/types";
import { groupNames, groupRows, hasGroups, UNGROUPED } from "./nodeGroups";

function listing(id: string, group: string | null): NodeListing {
  return {
    node: {
      id,
      title: id,
      group,
      cost: 1,
      status: "open",
      deferredOn: null,
      completedOn: null,
      prerequisiteIds: [],
      notes: null,
    },
    kind: "eligible",
    waitingOn: [],
    exceedsBudget: false,
  };
}

const shape = (listings: NodeListing[]) =>
  groupRows(listings).map((row) =>
    row.kind === "header" ? `# ${row.label} (${row.count})` : row.listing.node.id,
  );

const sections = (listings: NodeListing[]) =>
  groupRows(listings)
    .filter((row) => row.kind === "node")
    .map((row) => (row.kind === "node" ? row.section : null));

describe("groupRows", () => {
  it("leaves a plan with no groups exactly as it was", () => {
    const listings = [listing("a", null), listing("b", null)];
    expect(shape(listings)).toEqual(["a", "b"]);
    expect(hasGroups(listings)).toBe(false);
  });

  it("heads each run of a group with its name and size", () => {
    const listings = [
      listing("a", "Basics"),
      listing("b", "Basics"),
      listing("c", "Advanced"),
    ];
    expect(shape(listings)).toEqual(["# Basics (2)", "a", "b", "# Advanced (1)", "c"]);
    expect(hasGroups(listings)).toBe(true);
  });

  it("heads what follows a group so it is not read as part of it", () => {
    const listings = [listing("a", "Basics"), listing("b", null), listing("c", null)];
    expect(shape(listings)).toEqual(["# Basics (1)", "a", `# ${UNGROUPED} (2)`, "b", "c"]);
  });

  it("needs no heading for ungrouped nodes before the first group", () => {
    expect(shape([listing("a", null), listing("b", "Basics")])).toEqual([
      "a",
      "# Basics (1)",
      "b",
    ]);
  });

  it("heads a group named twice twice, rather than reordering the plan", () => {
    const listings = [
      listing("a", "Basics"),
      listing("b", "Advanced"),
      listing("c", "Basics"),
    ];
    expect(shape(listings)).toEqual([
      "# Basics (1)",
      "a",
      "# Advanced (1)",
      "b",
      "# Basics (1)",
      "c",
    ]);
  });

  it("treats a blank label as no group at all", () => {
    const listings = [listing("a", "   "), listing("b", null)];
    expect(shape(listings)).toEqual(["a", "b"]);
    expect(hasGroups(listings)).toBe(false);
  });

  it("tells each node which heading folds it away, and which have none", () => {
    // The two ungrouped nodes are not interchangeable: the first is drawn above any
    // heading, so nothing can collapse it; the last sits under "Ungrouped".
    expect(
      sections([
        listing("a", null),
        listing("b", "Basics"),
        listing("c", null),
      ]),
    ).toEqual([null, "Basics", UNGROUPED]);
  });

  it("names every group once, in the order it first appears", () => {
    expect(
      groupNames([
        listing("a", "Basics"),
        listing("b", "Advanced"),
        listing("c", "Basics"),
        listing("d", null),
      ]),
    ).toEqual(["Basics", "Advanced"]);
  });
});
