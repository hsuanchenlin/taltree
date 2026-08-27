import type { LaidOutNode, NavDirection } from "./types";

export function nearestNode(
  nodes: ReadonlyArray<Pick<LaidOutNode, "id" | "x" | "y" | "width" | "height">>,
  fromId: string | null,
  direction: NavDirection,
): string | null {
  if (nodes.length === 0) return null;
  const from = fromId ? nodes.find((node) => node.id === fromId) : undefined;
  if (!from) return nodes[0]?.id ?? null;

  const fx = from.x + from.width / 2;
  const fy = from.y + from.height / 2;
  const horizontal = direction === "left" || direction === "right";
  const sign = direction === "left" || direction === "up" ? -1 : 1;

  let bestId: string | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const node of nodes) {
    if (node.id === from.id) continue;
    const nx = node.x + node.width / 2;
    const ny = node.y + node.height / 2;
    const dx = nx - fx;
    const dy = ny - fy;
    const primary = horizontal ? dx : dy;
    const cross = horizontal ? dy : dx;
    if (primary * sign <= 0) continue;
    if (Math.abs(cross) > Math.abs(primary) * 2 + 48) continue;
    const score = Math.abs(primary) + Math.abs(cross) * 2;
    if (score < bestScore) {
      bestScore = score;
      bestId = node.id;
    }
  }

  return bestId;
}
