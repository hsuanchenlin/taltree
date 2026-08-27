import type { NodeKind } from "../domain/types";
import { KIND_LABEL } from "./format";

export function KindMark({ kind }: { kind: NodeKind }) {
  return (
    <span className={`kind kind-${kind}`}>
      <KindIcon kind={kind} />
      <span className="kind-text">{KIND_LABEL[kind]}</span>
    </span>
  );
}

function KindIcon({ kind }: { kind: NodeKind }) {
  const common = {
    width: 14,
    height: 14,
    viewBox: "0 0 14 14",
    "aria-hidden": true,
    focusable: false,
  } as const;
  switch (kind) {
    case "eligible":
      return (
        <svg {...common}>
          <circle cx="7" cy="7" r="5.4" fill="none" stroke="currentColor" strokeWidth="1.3" />
          <path d="M6 4.7 10.2 7 6 9.3Z" fill="currentColor" />
        </svg>
      );
    case "blocked":
      return (
        <svg {...common}>
          <rect x="3" y="6.2" width="8" height="5.3" rx="1.1" fill="none" stroke="currentColor" strokeWidth="1.3" />
          <path d="M5 6.2V4.6a2 2 0 0 1 4 0v1.6" fill="none" stroke="currentColor" strokeWidth="1.3" />
        </svg>
      );
    case "deferred":
      return (
        <svg {...common}>
          <rect x="3.4" y="3" width="2.1" height="8" rx="0.4" fill="currentColor" />
          <rect x="8.5" y="3" width="2.1" height="8" rx="0.4" fill="currentColor" />
        </svg>
      );
    case "completed":
      return (
        <svg {...common}>
          <path
            d="M2.5 7.2 5.6 10.2 11.6 3.8"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
  }
}

export function TreeMark() {
  return (
    <svg className="tree-mark" width="28" height="28" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 20 V8" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      <path d="M12 11.5 C12 11.5 8.5 9.5 7 6.5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      <path d="M12 13 C12 13 16 11.5 17.5 8" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      <circle cx="7" cy="6.5" r="1.3" fill="var(--ochre)" />
      <circle cx="17.5" cy="8" r="1.3" fill="currentColor" />
      <circle cx="12" cy="7.2" r="1.4" fill="currentColor" />
    </svg>
  );
}
