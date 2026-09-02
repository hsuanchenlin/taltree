export const RESOURCE_TYPES = [
  "official",
  "opensource",
  "article",
  "course",
  "podcast",
  "video",
  "book",
  "feed",
] as const;

export type ResourceType = (typeof RESOURCE_TYPES)[number];

export interface ResourceLink {
  type: ResourceType;
  title: string;
  url: string;
}

export interface ParsedNotes {
  body: string;
  links: ResourceLink[];
}

const RESOURCE_TYPE_SET = new Set<string>(RESOURCE_TYPES);

/** A list line: `- [@article@The Internet](https://en.wikipedia.org/wiki/Internet)`. */
const RESOURCE_LINE =
  /^\s*-\s*\[@([a-z]+)@([^\]]+)\]\(([^)]+)\)\s*$/;

export function parseNotes(notes: string | null | undefined): ParsedNotes {
  if (!notes) return { body: "", links: [] };

  const links: ResourceLink[] = [];
  const bodyLines: string[] = [];
  for (const line of notes.split(/\r?\n/)) {
    const link = parseResourceLine(line);
    if (link) links.push(link);
    else bodyLines.push(line);
  }
  return { body: trimBlankLines(bodyLines), links };
}

export function parseResourceLine(line: string): ResourceLink | null {
  const match = RESOURCE_LINE.exec(line);
  const type = match?.[1];
  const rawTitle = match?.[2];
  const rawUrl = match?.[3];
  if (!type || !rawTitle || !rawUrl) return null;
  if (!RESOURCE_TYPE_SET.has(type)) return null;
  const title = rawTitle.trim();
  const url = rawUrl.trim();
  if (!title || !isHttpUrl(url)) return null;
  return { type: type as ResourceType, title, url };
}

function isHttpUrl(url: string): boolean {
  return /^https?:\/\/\S/i.test(url);
}

function trimBlankLines(lines: string[]): string {
  let start = 0;
  let end = lines.length;
  while (start < end && (lines[start] ?? "").trim() === "") start += 1;
  while (end > start && (lines[end - 1] ?? "").trim() === "") end -= 1;
  return lines.slice(start, end).join("\n");
}
