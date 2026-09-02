import { describe, expect, it } from "vitest";
import { parseNotes, parseResourceLine } from "./notes";

const INTERNET =
  "- [@article@The Internet](https://en.wikipedia.org/wiki/Internet)";

describe("typed resource links", () => {
  it("reads a typed markdown list line into a tag and a title link", () => {
    expect(parseResourceLine(INTERNET)).toEqual({
      type: "article",
      title: "The Internet",
      url: "https://en.wikipedia.org/wiki/Internet",
    });
  });

  it("accepts every documented type", () => {
    const types = [
      "official",
      "opensource",
      "article",
      "course",
      "podcast",
      "video",
      "book",
      "feed",
    ] as const;
    for (const type of types) {
      const line = `- [@${type}@Example](https://example.com/${type})`;
      expect(parseResourceLine(line)?.type).toBe(type);
    }
  });

  it("leaves unknown types, non-list lines, and non-http urls in the notes body", () => {
    const notes = [
      "Read this first.",
      "- [@blog@Not a type](https://example.com/blog)",
      "- a plain bullet",
      "- [@article@Scripted](javascript:alert(1))",
      INTERNET,
      "",
      "Then write a summary.",
    ].join("\n");

    expect(parseNotes(notes)).toEqual({
      body: [
        "Read this first.",
        "- [@blog@Not a type](https://example.com/blog)",
        "- a plain bullet",
        "- [@article@Scripted](javascript:alert(1))",
        "",
        "Then write a summary.",
      ].join("\n"),
      links: [
        {
          type: "article",
          title: "The Internet",
          url: "https://en.wikipedia.org/wiki/Internet",
        },
      ],
    });
  });

  it("trims surrounding blank lines from the remaining notes body", () => {
    const parsed = parseNotes(`\n${INTERNET}\n\nKeep this.\n`);
    expect(parsed.body).toBe("Keep this.");
    expect(parsed.links).toHaveLength(1);
  });

  it("returns empty parsed notes when the field is missing", () => {
    expect(parseNotes(null)).toEqual({ body: "", links: [] });
    expect(parseNotes(undefined)).toEqual({ body: "", links: [] });
    expect(parseNotes("")).toEqual({ body: "", links: [] });
  });
});
