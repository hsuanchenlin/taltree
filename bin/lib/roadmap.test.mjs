import { describe, it, expect } from "vitest";
import { toPlanYaml } from "./planYaml.mjs";
import {
  convertRoadmap,
  isValidSlug,
  roadmapUrl,
  RoadmapError,
  sectionBands,
  slugify,
  summaryLines,
} from "./roadmap.mjs";

// A React Flow document shaped exactly like the public endpoint's, with invented
// content. roadmap.sh's own roadmaps are all-rights-reserved, so no fixture in this
// repository may carry their titles or their text.
function node(id, type, label, x, y, extra = {}) {
  return {
    id,
    type,
    position: { x, y },
    positionAbsolute: { x, y },
    data: label === null ? {} : { label, ...extra },
  };
}

function edge(source, target) {
  return { id: `${source}->${target}`, source, target, data: { edgeStyle: "solid" } };
}

/**
 * Two labelled sections, a title, a chain of three connected nodes, two nodes the
 * drawing connects to nothing, and chrome that must never become a plan node.
 */
function roadmap() {
  return {
    slug: "widgets",
    title: { card: "Widgets", page: "Widget Maker" },
    nodes: [
      node("t", "title", "Widget Maker", 0, -100),
      node("n1", "topic", "Bolt Basics", 0, 0),
      node("n2", "subtopic", "Choosing a bolt", 200, 40),
      node("n3", "topic", "Torque", 0, 200),
      node("l1", "label", "Advanced Widgets", 0, 500),
      node("n4", "topic", "Alloy Selection", 0, 600),
      node("n5", "subtopic", "Fatigue limits", 200, 640),
      node("legend1", "legend", "Legend", -400, 0),
      node("v1", "vertical", "vertical node", -50, 100),
      node("sec1", "section", null, -300, 900),
      node("btn1", "button", "Start learning", 400, -100),
    ],
    edges: [
      edge("t", "n1"), // chrome to node: says nothing about order
      edge("n1", "n2"),
      edge("n2", "n3"),
      edge("n4", "n5"),
      edge("n1", "ghost"), // a target no longer in the document
    ],
  };
}

const convert = (document = roadmap(), overrides = {}) =>
  convertRoadmap(document, { slug: "widgets", today: "2026-09-04", ...overrides });

describe("roadmapUrl", () => {
  it("addresses the public document endpoint by slug", () => {
    expect(roadmapUrl("frontend")).toBe("https://roadmap.sh/api/v1-official-roadmap/frontend");
    expect(roadmapUrl("ai-engineer")).toBe("https://roadmap.sh/api/v1-official-roadmap/ai-engineer");
  });

  it("refuses anything that is not a slug rather than building a URL out of it", () => {
    expect(isValidSlug("frontend")).toBe(true);
    expect(isValidSlug("../../etc/passwd")).toBe(false);
    expect(isValidSlug("Frontend")).toBe(false);
    expect(isValidSlug("")).toBe(false);
    expect(() => roadmapUrl("a/b")).toThrow(RoadmapError);
  });
});

describe("convertRoadmap", () => {
  it("keeps only the nodes that name something to do", () => {
    const { plan } = convert();
    expect(plan.nodes.map((n) => n.title)).toEqual([
      "Bolt Basics",
      "Choosing a bolt",
      "Torque",
      "Alloy Selection",
      "Fatigue limits",
    ]);
  });

  it("writes a plan both builds can load", () => {
    const { plan } = convert();
    expect(plan.version).toBe(1);
    expect(plan.title).toBe("Widget Maker");
    expect(plan.dailyBudget).toBe(8);
    expect(plan.activeDate).toBe("2026-09-04");
    expect(plan.spentToday).toBe(0);
    for (const planNode of plan.nodes) {
      expect(planNode.status).toBe("open");
      expect(Number.isInteger(planNode.cost)).toBe(true);
    }
  });

  it("serialises as the tree.yaml a person would have written by hand", () => {
    const yaml = toPlanYaml(convert().plan);
    expect(yaml.startsWith("# Taltree plan")).toBe(true);
    expect(yaml).toContain("group: Widget Maker");
    expect(yaml).toContain("group: Advanced Widgets");
    expect(yaml).toContain("id: bolt-basics");
    expect(yaml).not.toContain("prerequisiteIds: []");
    expect(yaml).not.toContain("notes:");
  });

  it("gives every node a human-readable id, made unique where titles repeat", () => {
    const document = roadmap();
    document.nodes.push(node("dup", "subtopic", "Torque", 400, 240));
    const { plan } = convert(document);
    expect(plan.nodes.map((n) => n.id)).toEqual([
      "bolt-basics",
      "choosing-a-bolt",
      "torque",
      "torque-2",
      "alloy-selection",
      "fatigue-limits",
    ]);
  });

  it("prices a topic above a subtopic", () => {
    const { plan } = convert();
    expect(plan.nodes.find((n) => n.id === "bolt-basics").cost).toBe(2);
    expect(plan.nodes.find((n) => n.id === "choosing-a-bolt").cost).toBe(1);
  });

  it("takes prerequisites only from edges between two teachable nodes", () => {
    const { plan, summary } = convert();
    const byId = Object.fromEntries(plan.nodes.map((n) => [n.id, n]));
    expect(byId["choosing-a-bolt"].prerequisiteIds).toEqual(["bolt-basics"]);
    expect(byId["torque"].prerequisiteIds).toEqual(["choosing-a-bolt"]);
    expect(byId["fatigue-limits"].prerequisiteIds).toEqual(["alloy-selection"]);
    expect(summary.edgesMapped).toBe(3);
    expect(summary.edgesInDocument).toBe(5);
  });

  it("imports a node the drawing connects to nothing as a root, not a guess", () => {
    const { plan, summary } = convert();
    const byId = Object.fromEntries(plan.nodes.map((n) => [n.id, n]));
    expect(byId["bolt-basics"].prerequisiteIds).toBeUndefined();
    expect(byId["alloy-selection"].prerequisiteIds).toBeUndefined();
    expect(summary.disconnected).toBe(2);
  });

  it("groups nodes by the document's own section labels", () => {
    const { plan, summary } = convert();
    const groups = Object.fromEntries(plan.nodes.map((n) => [n.id, n.group]));
    expect(groups).toEqual({
      "bolt-basics": "Widget Maker",
      "choosing-a-bolt": "Widget Maker",
      torque: "Widget Maker",
      "alloy-selection": "Advanced Widgets",
      "fatigue-limits": "Advanced Widgets",
    });
    expect(summary.groups).toEqual([
      { label: "Widget Maker", count: 3 },
      { label: "Advanced Widgets", count: 2 },
    ]);
  });

  it("leaves every node ungrouped when the document names no sections", () => {
    const document = roadmap();
    document.nodes = document.nodes.filter((n) => n.type !== "label");
    const { plan, summary } = convert(document);
    expect(plan.nodes.every((n) => n.group === undefined)).toBe(true);
    expect(summary.groups).toEqual([]);
  });

  it("orders nodes down the drawing so a group's nodes stay together", () => {
    const { plan } = convert();
    expect(plan.nodes.map((n) => n.group)).toEqual([
      "Widget Maker",
      "Widget Maker",
      "Widget Maker",
      "Advanced Widgets",
      "Advanced Widgets",
    ]);
  });

  it("drops an edge that would close a cycle rather than writing a plan that will not load", () => {
    const document = roadmap();
    document.edges.push(edge("n3", "n1"));
    const { plan, summary } = convert(document);
    expect(summary.cyclesDropped).toBe(1);
    expect(plan.nodes.find((n) => n.id === "bolt-basics").prerequisiteIds).toBeUndefined();
  });

  it("collapses whitespace and clips a title past the length both builds accept", () => {
    const document = roadmap();
    document.nodes.push(node("wide", "topic", `  Spaced   out\n title  `, 0, 700));
    document.nodes.push(node("long", "topic", "L".repeat(400), 0, 800));
    const { plan } = convert(document);
    expect(plan.nodes.find((n) => n.id === "spaced-out-title").title).toBe("Spaced out title");
    expect(plan.nodes.find((n) => n.title.startsWith("LLL")).title).toHaveLength(200);
  });

  it("falls back to the slug when the document names no title", () => {
    const document = roadmap();
    delete document.title;
    expect(convert(document).plan.title).toBe("widgets");
  });

  it("refuses a response that is not a roadmap document", () => {
    expect(() => convert({})).toThrow(RoadmapError);
    expect(() => convert(null)).toThrow(RoadmapError);
  });

  it("takes the budget the person asked for", () => {
    expect(convert(roadmap(), { dailyBudget: 4 }).plan.dailyBudget).toBe(4);
  });
});

describe("sectionBands", () => {
  it("starts at the roadmap title and opens a new band at every label", () => {
    expect(sectionBands(roadmap().nodes)).toEqual([
      { label: "Widget Maker", top: -Infinity },
      { label: "Advanced Widgets", top: 500 },
    ]);
  });

  it("reports one unnamed band when the document has no labels", () => {
    expect(sectionBands([node("n1", "topic", "Alone", 0, 0)])).toEqual([
      { label: null, top: -Infinity },
    ]);
  });
});

describe("slugify", () => {
  it("makes the human-readable ids a hand-written plan uses", () => {
    expect(slugify("How does the internet work?")).toBe("how-does-the-internet-work");
    expect(slugify("CI/CD")).toBe("ci-cd");
    expect(slugify("Café Décor")).toBe("cafe-decor");
    expect(slugify("!!!")).toBe("");
  });
});

describe("summaryLines", () => {
  it("says what was mapped and warns that the rest was not guessed", () => {
    const { summary } = convert();
    const text = summaryLines(summary, "/plans/widgets.yaml").join("\n");
    expect(text).toContain("Imported 5 nodes from roadmap.sh/widgets");
    expect(text).toContain("Mapped 3 of 5 edges");
    expect(text).toContain("2 nodes arrived with none");
    expect(text).toContain("Advanced Widgets (2)");
    expect(text).toContain("/plans/widgets.yaml");
    expect(text).toContain("Edit the file to add the rest.");
  });
});
