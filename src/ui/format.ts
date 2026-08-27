import type { NodeKind } from "../domain/types";

export const KIND_LABEL: Record<NodeKind, string> = {
  eligible: "Eligible",
  blocked: "Blocked",
  deferred: "Deferred today",
  completed: "Completed",
};

export function formatDay(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  if (!year || !month || !day) return isoDate;
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function pointsLabel(n: number): string {
  return n === 1 ? "1 point" : `${n} points`;
}
