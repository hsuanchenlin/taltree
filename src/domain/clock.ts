import type { Clock } from "./types";

export function systemClock(): Clock {
  return {
    today() {
      const d = new Date();
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    },
  };
}

export function frozenClock(date: string): Clock {
  return { today: () => date };
}
