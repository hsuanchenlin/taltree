import type { RendererChoice } from "../diagnostics";

/**
 * Which renderer the person asked for, remembered across reloads. The relic
 * slab is the default, but a device where WebGL paints a black board needs a
 * way out that survives a refresh - hence an explicit, persisted choice rather
 * than only the automatic WebGL fallback.
 */

export const RENDERER_STORAGE_KEY = "taltree.renderer.v1";

export const DEFAULT_RENDERER: RendererChoice = "relic";

export const RENDERER_CHOICES: readonly {
  value: RendererChoice;
  label: string;
  hint: string;
}[] = [
  {
    value: "relic",
    label: "Relic tree",
    hint: "The WebGL slab. Falls back to the classic tree if WebGL is missing.",
  },
  {
    value: "classic",
    label: "Classic tree",
    hint: "The SVG/DOM tree. Use this if the relic slab renders black.",
  },
  {
    value: "list",
    label: "List",
    hint: "The keyboard-operable list of the same plan.",
  },
];

export function isRendererChoice(value: unknown): value is RendererChoice {
  return value === "relic" || value === "classic" || value === "list";
}

export function loadRendererChoice(
  storage: Pick<Storage, "getItem"> | null,
): RendererChoice {
  if (!storage) return DEFAULT_RENDERER;
  try {
    const raw = storage.getItem(RENDERER_STORAGE_KEY);
    return isRendererChoice(raw) ? raw : DEFAULT_RENDERER;
  } catch {
    return DEFAULT_RENDERER;
  }
}

export function saveRendererChoice(
  storage: Pick<Storage, "setItem"> | null,
  choice: RendererChoice,
): void {
  if (!storage) return;
  try {
    storage.setItem(RENDERER_STORAGE_KEY, choice);
  } catch {
    // A blocked or full storage only costs the preference, never the session.
  }
}

/**
 * What the `v` key does: it swaps between the list and a tree, keeping
 * whichever tree renderer was last chosen instead of forcing one of them.
 */
export function toggleRendererChoice(
  current: RendererChoice,
  lastTree: RendererChoice,
): RendererChoice {
  if (current !== "list") return "list";
  return lastTree === "list" ? DEFAULT_RENDERER : lastTree;
}
