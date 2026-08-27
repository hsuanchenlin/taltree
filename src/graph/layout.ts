import type {
  GraphEdge,
  GraphModel,
  GraphNode,
  LaidOutEdge,
  LaidOutGraph,
  LaidOutNode,
} from "./types";
import { TREE_LAYOUT } from "./types";

interface ComponentLayout {
  nodes: LaidOutNode[];
  width: number;
  height: number;
}

export function layoutGraph(model: GraphModel): LaidOutGraph {
  if (model.nodes.length === 0) {
    return {
      nodes: [],
      edges: [],
      width: TREE_LAYOUT.padding * 2,
      height: TREE_LAYOUT.padding * 2,
    };
  }

  const components = connectedComponents(model);
  const componentOf = new Map<string, number>();
  components.forEach((nodes, index) => {
    for (const node of nodes) componentOf.set(node.id, index);
  });
  const componentEdges: GraphEdge[][] = components.map(() => []);
  for (const edge of model.edges) {
    const index = componentOf.get(edge.from);
    if (index === undefined || componentOf.get(edge.to) !== index) continue;
    componentEdges[index]?.push(edge);
  }
  const laidOut = components.map((nodes, index) =>
    layoutComponent(nodes, componentEdges[index] ?? []),
  );

  const packed = packComponents(laidOut);
  const byId = new Map(packed.nodes.map((node) => [node.id, node]));
  const edges: LaidOutEdge[] = [];
  for (const edge of model.edges) {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (!from || !to) continue;
    edges.push(placeEdge(edge, from, to));
  }

  return {
    nodes: packed.nodes,
    edges,
    width: packed.width,
    height: packed.height,
  };
}

function connectedComponents(model: GraphModel): GraphNode[][] {
  const byId = new Map(model.nodes.map((node) => [node.id, node]));
  const parent = new Map<string, string>();
  for (const node of model.nodes) parent.set(node.id, node.id);

  function find(id: string): string {
    const current = parent.get(id) ?? id;
    if (current === id) return id;
    const root = find(current);
    parent.set(id, root);
    return root;
  }

  function union(a: string, b: string) {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return;
    const nodeA = byId.get(ra);
    const nodeB = byId.get(rb);
    const aIndex = nodeA?.originalIndex ?? 0;
    const bIndex = nodeB?.originalIndex ?? 0;
    if (aIndex <= bIndex) parent.set(rb, ra);
    else parent.set(ra, rb);
  }

  for (const edge of model.edges) {
    if (byId.has(edge.from) && byId.has(edge.to)) union(edge.from, edge.to);
  }

  const groups = new Map<string, GraphNode[]>();
  for (const node of model.nodes) {
    const root = find(node.id);
    const list = groups.get(root) ?? [];
    list.push(node);
    groups.set(root, list);
  }

  const components = [...groups.values()].map((nodes) =>
    [...nodes].sort((a, b) => a.originalIndex - b.originalIndex),
  );
  components.sort((a, b) => (a[0]?.originalIndex ?? 0) - (b[0]?.originalIndex ?? 0));
  return components;
}

function layoutComponent(nodes: GraphNode[], edges: GraphEdge[]): ComponentLayout {
  const ranks = assignRanks(nodes, edges);
  const order = orderRanks(nodes, edges, ranks);
  const positions = new Map<string, { x: number; y: number }>();
  const indexById = new Map(nodes.map((node) => [node.id, node.originalIndex]));
  const parentsById = new Map<string, string[]>();
  for (const node of nodes) parentsById.set(node.id, []);
  for (const edge of edges) parentsById.get(edge.to)?.push(edge.from);

  const maxRank = Math.max(...ranks.values(), 0);
  for (let rank = 0; rank <= maxRank; rank += 1) {
    const row = order[rank] ?? [];
    const desired = row.map((id, index) => {
      const parentXs = (parentsById.get(id) ?? [])
        .map((parentId) => positions.get(parentId)?.x)
        .filter((x): x is number => x !== undefined);
      const x =
        parentXs.length > 0
          ? Math.round(mean(parentXs))
          : index * (TREE_LAYOUT.nodeWidth + TREE_LAYOUT.columnGap);
      return { id, x };
    });
    desired.sort(
      (a, b) => a.x - b.x || (indexById.get(a.id) ?? 0) - (indexById.get(b.id) ?? 0),
    );
    let cursor = 0;
    for (const item of desired) {
      const x = Math.max(item.x, cursor);
      positions.set(item.id, {
        x,
        y: rank * (TREE_LAYOUT.nodeHeight + TREE_LAYOUT.rankGap),
      });
      cursor = x + TREE_LAYOUT.nodeWidth + TREE_LAYOUT.columnGap;
    }
  }

  let minX = Infinity;
  let maxX = 0;
  let maxY = 0;
  for (const pos of positions.values()) {
    minX = Math.min(minX, pos.x);
    maxX = Math.max(maxX, pos.x + TREE_LAYOUT.nodeWidth);
    maxY = Math.max(maxY, pos.y + TREE_LAYOUT.nodeHeight);
  }
  if (!Number.isFinite(minX)) minX = 0;
  const shift = minX;
  const laid: LaidOutNode[] = nodes.map((node) => {
    const pos = positions.get(node.id) ?? { x: 0, y: 0 };
    return {
      ...node,
      x: pos.x - shift,
      y: pos.y,
      width: TREE_LAYOUT.nodeWidth,
      height: TREE_LAYOUT.nodeHeight,
    };
  });

  return {
    nodes: laid,
    width: Math.max(TREE_LAYOUT.nodeWidth, maxX - shift),
    height: Math.max(TREE_LAYOUT.nodeHeight, maxY),
  };
}

function assignRanks(nodes: GraphNode[], edges: GraphEdge[]): Map<string, number> {
  const ids = new Set(nodes.map((node) => node.id));
  const incoming = new Map<string, string[]>();
  for (const node of nodes) incoming.set(node.id, []);
  for (const edge of edges) {
    if (!ids.has(edge.from) || !ids.has(edge.to)) continue;
    incoming.get(edge.to)?.push(edge.from);
  }

  const ranks = new Map<string, number>();
  const visiting = new Set<string>();

  function rankOf(id: string): number {
    const cached = ranks.get(id);
    if (cached !== undefined) return cached;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const parents = incoming.get(id) ?? [];
    const rank = parents.length === 0 ? 0 : Math.max(...parents.map(rankOf)) + 1;
    visiting.delete(id);
    ranks.set(id, rank);
    return rank;
  }

  for (const node of nodes) rankOf(node.id);
  return ranks;
}

function orderRanks(
  nodes: GraphNode[],
  edges: GraphEdge[],
  ranks: Map<string, number>,
): string[][] {
  const byRank = new Map<number, string[]>();
  const indexOf = new Map(nodes.map((node) => [node.id, node.originalIndex]));
  for (const node of nodes) {
    const rank = ranks.get(node.id) ?? 0;
    const row = byRank.get(rank) ?? [];
    row.push(node.id);
    byRank.set(rank, row);
  }
  for (const row of byRank.values()) {
    row.sort((a, b) => (indexOf.get(a) ?? 0) - (indexOf.get(b) ?? 0));
  }

  const maxRank = Math.max(...ranks.values(), 0);
  const children = new Map<string, string[]>();
  const parents = new Map<string, string[]>();
  for (const node of nodes) {
    children.set(node.id, []);
    parents.set(node.id, []);
  }
  for (const edge of edges) {
    children.get(edge.from)?.push(edge.to);
    parents.get(edge.to)?.push(edge.from);
  }

  function barycenter(ids: string[], neighborsOf: (id: string) => string[], orderIndex: Map<string, number>) {
    return [...ids].sort((a, b) => {
      const ka = neighborMean(neighborsOf(a), orderIndex);
      const kb = neighborMean(neighborsOf(b), orderIndex);
      if (ka !== kb) return ka - kb;
      return (indexOf.get(a) ?? 0) - (indexOf.get(b) ?? 0);
    });
  }

  for (let pass = 0; pass < 3; pass += 1) {
    for (let rank = 1; rank <= maxRank; rank += 1) {
      const row = byRank.get(rank);
      if (!row) continue;
      const orderIndex = indexMap(byRank);
      byRank.set(
        rank,
        barycenter(row, (id) => parents.get(id) ?? [], orderIndex),
      );
    }
    for (let rank = maxRank - 1; rank >= 0; rank -= 1) {
      const row = byRank.get(rank);
      if (!row) continue;
      const orderIndex = indexMap(byRank);
      byRank.set(
        rank,
        barycenter(row, (id) => children.get(id) ?? [], orderIndex),
      );
    }
  }

  const ordered: string[][] = [];
  for (let rank = 0; rank <= maxRank; rank += 1) {
    ordered[rank] = byRank.get(rank) ?? [];
  }
  return ordered;
}

function indexMap(byRank: Map<number, string[]>): Map<string, number> {
  const order = new Map<string, number>();
  for (const row of byRank.values()) {
    row.forEach((id, index) => order.set(id, index));
  }
  return order;
}

function neighborMean(ids: string[], orderIndex: Map<string, number>): number {
  if (ids.length === 0) return Number.POSITIVE_INFINITY;
  const values = ids
    .map((id) => orderIndex.get(id))
    .filter((value): value is number => value !== undefined);
  if (values.length === 0) return Number.POSITIVE_INFINITY;
  return mean(values);
}

function packComponents(components: ComponentLayout[]): {
  nodes: LaidOutNode[];
  width: number;
  height: number;
} {
  const pad: number = TREE_LAYOUT.padding;
  let x: number = pad;
  let y: number = pad;
  let rowHeight = 0;
  let maxX: number = pad;
  const nodes: LaidOutNode[] = [];

  for (const component of components) {
    const nextRight = x + component.width;
    if (x > pad && nextRight > pad + TREE_LAYOUT.targetRowWidth) {
      x = pad;
      y += rowHeight + TREE_LAYOUT.rowGap;
      rowHeight = 0;
    }
    for (const node of component.nodes) {
      nodes.push({ ...node, x: node.x + x, y: node.y + y });
    }
    x += component.width + TREE_LAYOUT.componentGap;
    rowHeight = Math.max(rowHeight, component.height);
    maxX = Math.max(maxX, x - TREE_LAYOUT.componentGap);
  }

  return {
    nodes,
    width: Math.max(pad * 2, maxX + pad),
    height: Math.max(pad * 2, y + rowHeight + pad),
  };
}

function placeEdge(edge: GraphEdge, from: LaidOutNode, to: LaidOutNode): LaidOutEdge {
  const x1 = Math.round(from.x + from.width / 2);
  const y1 = from.y + from.height;
  const x2 = Math.round(to.x + to.width / 2);
  const y2 = to.y;
  const midY = Math.round((y1 + y2) / 2);
  return {
    ...edge,
    x1,
    y1,
    x2,
    y2,
    d: `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`,
  };
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function nodeBoxesOverlap(a: LaidOutNode, b: LaidOutNode): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}
