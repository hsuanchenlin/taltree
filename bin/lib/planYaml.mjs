// Writing a plan as the `tree.yaml` both builds already read.
//
// The document is the person's, not the importer's, so what lands on disk has to be
// exactly what they would have written by hand: the same header, the same field
// order, and no `null`s standing in for fields that simply are not there.

import { stringify } from "yaml";

/** The comment the Rust build writes at the top of every saved plan. */
export const HEADER =
  "# Taltree plan. Edit by hand if you like: ids are stable references,\n# dates are YYYY-MM-DD, and costs are whole points.\n";

/** Node fields in the order both builds serialise them. */
const NODE_FIELDS = [
  "id",
  "title",
  "group",
  "cost",
  "status",
  "deferredOn",
  "completedOn",
  "prerequisiteIds",
  "notes",
];

export function toPlanYaml(plan) {
  const document = {
    version: plan.version,
    title: plan.title,
    dailyBudget: plan.dailyBudget,
    activeDate: plan.activeDate,
    spentToday: plan.spentToday,
    nodes: (plan.nodes ?? []).map(orderNodeFields),
  };
  return HEADER + stringify(document, { lineWidth: 0 });
}

export function toPlanJson(plan) {
  return `${JSON.stringify({ ...plan, nodes: (plan.nodes ?? []).map(orderNodeFields) }, null, 2)}\n`;
}

/** Drop absent optionals and put what remains in the documented order. */
function orderNodeFields(node) {
  const ordered = {};
  for (const field of NODE_FIELDS) {
    const value = node[field];
    if (value === undefined || value === null) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    ordered[field] = value;
  }
  return ordered;
}
