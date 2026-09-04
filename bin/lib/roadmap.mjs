// Turning a public roadmap.sh document into a Taltree plan. Pure: no network, no
// filesystem, no clock. `bin/taltree.mjs` does the fetching and the writing.
//
// The source is a drawing, not a dependency graph. Its boxes are placed by hand and
// most of its reading order is carried by position rather than by an edge, so this
// converter refuses to invent structure it cannot see:
//
//   - a prerequisite is written only where the document draws an edge between two
//     teachable nodes; everything else arrives as a root the person can wire up,
//   - grouping comes from the document's own section labels, which is the one piece
//     of top-level structure it does state rather than imply.
//
// Nothing but node titles and ids crosses this boundary. The roadmap.sh content
// files are all-rights-reserved and are never fetched, quoted, or stored.

/** The public, unauthenticated document endpoint. One roadmap per slug. */
export const ROADMAP_API = "https://roadmap.sh/api/v1-official-roadmap";

/** Node types that name something a person can actually do. */
const TEACHABLE = new Set(["topic", "subtopic"]);

/** What a node of each teachable type costs, in points. */
const COST = { topic: 2, subtopic: 1 };

/** Matches the caps both builds enforce (`MAX_TITLE`, `MAX_COST`, `MAX_BUDGET`). */
const MAX_TITLE = 200;

/** Budget a fresh import starts with, matching the seeded demo plan. */
export const DEFAULT_BUDGET = 8;

export class RoadmapError extends Error {}

/** Slugs address a roadmap in a URL path, so keep them to what a path segment holds. */
export function isValidSlug(slug) {
  return typeof slug === "string" && /^[a-z0-9][a-z0-9-]{0,62}$/.test(slug);
}

export function roadmapUrl(slug) {
  if (!isValidSlug(slug)) {
    throw new RoadmapError(
      `"${slug}" is not a roadmap slug; use the name from the roadmap.sh URL, like "frontend" or "ai-engineer"`,
    );
  }
  return `${ROADMAP_API}/${slug}`;
}

/**
 * Convert a fetched roadmap document into `{ plan, summary }`.
 *
 * `summary` is what the command prints: it names every derivation so the person can
 * see what was guessed and correct it in the file.
 */
export function convertRoadmap(document, { slug, today, dailyBudget = DEFAULT_BUDGET } = {}) {
  if (!isRecord(document) || !Array.isArray(document.nodes)) {
    throw new RoadmapError("that response is not a roadmap document");
  }
  const edges = Array.isArray(document.edges) ? document.edges : [];
  const bands = sectionBands(document.nodes);

  const teachable = document.nodes
    .filter((node) => isRecord(node) && TEACHABLE.has(node.type) && labelOf(node))
    .map((node) => ({
      source: node,
      y: coordinate(node, "y"),
      x: coordinate(node, "x"),
      band: bandIndexFor(bands, coordinate(node, "y")),
    }));

  // Top to bottom, then left to right: the order the drawing is read in, which also
  // keeps every group's nodes contiguous for the surfaces that draw group headers.
  teachable.sort((a, b) => a.band - b.band || a.y - b.y || a.x - b.x);

  const idFor = new Map();
  const taken = new Set();
  for (const entry of teachable) {
    const id = uniqueId(slugify(labelOf(entry.source)) || "node", taken);
    taken.add(id);
    idFor.set(entry.source.id, id);
  }

  const nodes = teachable.map((entry) => {
    const node = {
      id: idFor.get(entry.source.id),
      title: clip(labelOf(entry.source), MAX_TITLE),
      cost: COST[entry.source.type] ?? 1,
      status: "open",
      prerequisiteIds: [],
    };
    const group = bands[entry.band]?.label;
    if (group) node.group = group;
    return node;
  });
  const byId = new Map(nodes.map((node) => [node.id, node]));

  let edgesMapped = 0;
  let edgesDropped = 0;
  let cyclesDropped = 0;
  for (const edge of edges) {
    const from = isRecord(edge) ? idFor.get(edge.source) : undefined;
    const to = isRecord(edge) ? idFor.get(edge.target) : undefined;
    // An edge that touches a title, a label, or any other piece of chrome says
    // nothing about what has to happen first.
    if (!from || !to || from === to) {
      edgesDropped += 1;
      continue;
    }
    const target = byId.get(to);
    if (target.prerequisiteIds.includes(from)) continue;
    if (wouldCycle(byId, to, from)) {
      cyclesDropped += 1;
      continue;
    }
    target.prerequisiteIds.push(from);
    edgesMapped += 1;
  }

  for (const node of nodes) {
    if (node.prerequisiteIds.length === 0) delete node.prerequisiteIds;
  }

  const plan = {
    version: 1,
    title: clip(planTitle(document, slug), MAX_TITLE),
    dailyBudget,
    activeDate: today,
    spentToday: 0,
    nodes,
  };

  const groups = [];
  for (const node of nodes) {
    if (!node.group) continue;
    const found = groups.find((entry) => entry.label === node.group);
    if (found) found.count += 1;
    else groups.push({ label: node.group, count: 1 });
  }

  return {
    plan,
    summary: {
      slug,
      title: plan.title,
      nodes: nodes.length,
      topics: teachable.filter((entry) => entry.source.type === "topic").length,
      subtopics: teachable.filter((entry) => entry.source.type === "subtopic").length,
      skipped: document.nodes.length - teachable.length,
      edgesInDocument: edges.length,
      edgesMapped,
      edgesDropped,
      cyclesDropped,
      disconnected: nodes.filter((node) => !node.prerequisiteIds).length,
      totalCost: nodes.reduce((sum, node) => sum + node.cost, 0),
      groups,
    },
  };
}

/**
 * The document's own top-level sections, as bands down the drawing.
 *
 * A roadmap states its sections with `label` nodes dropped between the rows they
 * head, so a band runs from its label down to the next one, and the roadmap `title`
 * heads whatever sits above the first label. One band alone is not a grouping - it
 * would put every node under the same heading - so that case reports none.
 */
export function sectionBands(nodes) {
  const labels = nodes
    .filter((node) => isRecord(node) && node.type === "label" && labelOf(node))
    .map((node) => ({ label: clip(labelOf(node), MAX_TITLE), top: coordinate(node, "y") }))
    .sort((a, b) => a.top - b.top);
  if (labels.length === 0) return [{ label: null, top: -Infinity }];

  const heading = nodes.find((node) => isRecord(node) && node.type === "title" && labelOf(node));
  const first = heading
    ? { label: clip(labelOf(heading), MAX_TITLE), top: -Infinity }
    : { label: null, top: -Infinity };
  return [first, ...labels];
}

/** The band a node at `y` falls in: the last one that starts at or above it. */
function bandIndexFor(bands, y) {
  let index = 0;
  for (let i = 0; i < bands.length; i++) {
    if (bands[i].top <= y) index = i;
  }
  return index;
}

/** True when making `from` a prerequisite of `to` would close a loop. */
function wouldCycle(byId, to, from) {
  const seen = new Set();
  const stack = [from];
  while (stack.length > 0) {
    const id = stack.pop();
    if (id === to) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    const node = byId.get(id);
    if (node) stack.push(...node.prerequisiteIds);
  }
  return false;
}

function planTitle(document, slug) {
  const title = document.title;
  if (typeof title === "string" && title.trim()) return title.trim();
  if (isRecord(title)) {
    for (const key of ["page", "card"]) {
      if (typeof title[key] === "string" && title[key].trim()) return title[key].trim();
    }
  }
  return slug;
}

function labelOf(node) {
  const label = isRecord(node.data) ? node.data.label : null;
  return typeof label === "string" ? label.replace(/\s+/g, " ").trim() : "";
}

/** React Flow keeps two positions; either can be missing on a hand-edited document. */
function coordinate(node, axis) {
  for (const key of ["positionAbsolute", "position"]) {
    const point = node[key];
    if (isRecord(point) && Number.isFinite(point[axis])) return point[axis];
  }
  return 0;
}

/** Human-readable ids, the way a hand-written plan spells them. */
export function slugify(text) {
  return text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

function uniqueId(base, taken) {
  if (!taken.has(base)) return base;
  for (let suffix = 2; ; suffix++) {
    const candidate = `${base}-${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

function clip(text, limit) {
  return text.length <= limit ? text : `${text.slice(0, limit - 1).trimEnd()}…`;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The lines `taltree import` prints once the file is written. */
export function summaryLines(summary, path) {
  const lines = [
    `Imported ${summary.nodes} nodes from roadmap.sh/${summary.slug} (${summary.topics} topics, ${summary.subtopics} subtopics).`,
    `Mapped ${summary.edgesMapped} of ${summary.edgesInDocument} edges into prerequisites; ${summary.disconnected} nodes arrived with none.`,
  ];
  if (summary.cyclesDropped > 0) {
    lines.push(
      `Dropped ${summary.cyclesDropped} edges that would have formed a cycle. Taltree plans are acyclic.`,
    );
  }
  if (summary.groups.length > 0) {
    lines.push(
      `Groups: ${summary.groups.map((group) => `${group.label} (${group.count})`).join(", ")}.`,
    );
  }
  lines.push(`Whole plan costs ${summary.totalCost} points. Saved to ${path}.`);
  lines.push(
    "roadmap.sh draws most of its ordering by position rather than with edges, so the",
  );
  lines.push(
    "prerequisites above are only the ones it states. Edit the file to add the rest.",
  );
  return lines;
}
