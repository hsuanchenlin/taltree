import { describe, expect, it } from "vitest";
import {
  DEFAULT_RENDERER,
  isRendererChoice,
  loadRendererChoice,
  RENDERER_CHOICES,
  RENDERER_STORAGE_KEY,
  saveRendererChoice,
  toggleRendererChoice,
} from "./rendererPreference";

function memoryStorage(initial?: string) {
  const store = new Map<string, string>();
  if (initial !== undefined) store.set(RENDERER_STORAGE_KEY, initial);
  return {
    store,
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
  };
}

describe("renderer preference", () => {
  it("offers exactly the relic, classic, and list renderers", () => {
    expect(RENDERER_CHOICES.map((choice) => choice.value)).toEqual([
      "relic",
      "classic",
      "list",
    ]);
  });

  it("defaults to the relic slab when nothing is stored", () => {
    expect(loadRendererChoice(memoryStorage())).toBe(DEFAULT_RENDERER);
    expect(loadRendererChoice(null)).toBe(DEFAULT_RENDERER);
  });

  it("reads back a stored choice", () => {
    expect(loadRendererChoice(memoryStorage("classic"))).toBe("classic");
    expect(loadRendererChoice(memoryStorage("list"))).toBe("list");
  });

  it("ignores a stored value that is not a renderer", () => {
    expect(loadRendererChoice(memoryStorage("webgpu"))).toBe(DEFAULT_RENDERER);
    expect(isRendererChoice("webgpu")).toBe(false);
  });

  it("falls back to the default when storage throws", () => {
    const hostile = {
      getItem: () => {
        throw new Error("storage disabled");
      },
    };
    expect(loadRendererChoice(hostile)).toBe(DEFAULT_RENDERER);
    expect(() =>
      saveRendererChoice(
        {
          setItem: () => {
            throw new Error("storage disabled");
          },
        },
        "classic",
      ),
    ).not.toThrow();
  });

  it("persists a choice under the documented key", () => {
    const storage = memoryStorage();
    saveRendererChoice(storage, "classic");
    expect(storage.store.get(RENDERER_STORAGE_KEY)).toBe("classic");
  });

  it("toggles to the list and back to the tree renderer last used", () => {
    expect(toggleRendererChoice("classic", "classic")).toBe("list");
    expect(toggleRendererChoice("list", "classic")).toBe("classic");
    expect(toggleRendererChoice("list", "relic")).toBe("relic");
    // A stored preference of "list" must not leave the toggle with no tree.
    expect(toggleRendererChoice("list", "list")).toBe(DEFAULT_RENDERER);
  });
});
