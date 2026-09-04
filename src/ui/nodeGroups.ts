import type { NodeListing } from "../domain/types";

/**
 * The list panel's rows: nodes, with a heading wherever the group label changes.
 *
 * Grouping is a property of the document, so it is drawn where the document's own
 * order can carry it, and nothing is reordered - a person who wrote their plan in a
 * deliberate order keeps it, and an imported plan already arrives with each group's
 * nodes together. The same rule runs in the terminal build (`tui/src/ui/rows.rs`), so
 * the two boards read alike.
 *
 * A heading is a row and nothing else: selection walks listings, so a heading can
 * never be selected, completed, or deferred.
 */
export type GroupRow =
  | { kind: "header"; label: string; count: number; grouped: boolean }
  /**
   * `section` is the heading this node sits under, or `null` when it has none -
   * which is what a collapse toggle needs, since ungrouped nodes drawn before the
   * first group have no heading to fold them away with.
   */
  | { kind: "node"; listing: NodeListing; section: string | null };

/** The heading over nodes that name no group, once some other group has been drawn. */
export const UNGROUPED = "Ungrouped";

export function groupRows(listings: NodeListing[]): GroupRow[] {
  const rows: GroupRow[] = [];
  let current: string | null | undefined = undefined;
  let section: string | null = null;
  let opened = false;
  for (let index = 0; index < listings.length; index++) {
    const listing = listings[index];
    if (!listing) continue;
    const group = groupLabel(listing);
    if (group !== current) {
      // A run of ungrouped nodes needs no heading of its own, but once a group has
      // been drawn, leaving it does: without that the nodes after a group read as if
      // they were still inside it.
      if (group !== null) {
        rows.push({ kind: "header", label: group, count: runLength(listings, index), grouped: true });
        section = group;
        opened = true;
      } else if (opened) {
        rows.push({ kind: "header", label: UNGROUPED, count: runLength(listings, index), grouped: false });
        section = UNGROUPED;
      } else {
        section = null;
      }
      current = group;
    }
    rows.push({ kind: "node", listing, section });
  }
  return rows;
}

/** True when any node in the list names a group at all. */
export function hasGroups(listings: NodeListing[]): boolean {
  return listings.some((listing) => groupLabel(listing) !== null);
}

/** Every group named in the list, in the order it first appears. */
export function groupNames(listings: NodeListing[]): string[] {
  const names: string[] = [];
  for (const listing of listings) {
    const label = groupLabel(listing);
    if (label !== null && !names.includes(label)) names.push(label);
  }
  return names;
}

/** A node's group, or `null` when it names one that is only whitespace. */
export function groupLabel(listing: NodeListing): string | null {
  const label = listing.node.group?.trim();
  return label ? label : null;
}

/** How many nodes share `index`'s group before the label changes. */
function runLength(listings: NodeListing[], index: number): number {
  const first = listings[index];
  if (!first) return 0;
  const label = groupLabel(first);
  let count = 0;
  for (let at = index; at < listings.length; at++) {
    const listing = listings[at];
    if (!listing || groupLabel(listing) !== label) break;
    count += 1;
  }
  return count;
}
