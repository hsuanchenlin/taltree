// The plan library: where imported and hand-written plans live, which one is active,
// and how a short name resolves to a file.
//
// One `tree.yaml` is enough for a Thursday. A person who holds a curriculum as well
// needs somewhere to keep several documents and a way to say which one `taltree`
// opens, so the library is a plain directory of plan files plus a one-line pointer
// at the active one. Both are files a person can read, move, and delete.
//
// The pointer records an absolute path rather than a short name, so `taltree load`
// works on a plan anywhere on disk and a renamed library directory fails loudly
// instead of silently opening a different plan.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve, sep } from "node:path";
import { parse } from "yaml";

/** Extensions the library lists and `taltree load <name>` resolves, best first. */
export const PLAN_EXTENSIONS = [".yaml", ".yml", ".json"];

export class PlanLibraryError extends Error {}

/** `$XDG_CONFIG_HOME/taltree`, else `$HOME/.config/taltree`. Mirrors `tui/src/cli.rs`. */
export function configDir(env = process.env, home = homedir()) {
  const xdg = env.XDG_CONFIG_HOME;
  if (typeof xdg === "string" && xdg.trim()) return join(xdg, "taltree");
  return join(home, ".config", "taltree");
}

export function plansDir(env = process.env, home = homedir()) {
  return join(configDir(env, home), "plans");
}

/** The file naming the active plan. One line, an absolute path, no trailing anything. */
export function activePointerPath(env = process.env, home = homedir()) {
  return join(configDir(env, home), "active");
}

/**
 * The plan `taltree` opens when no path is given, or `null` when none is set.
 *
 * A pointer at a file that is no longer there comes back with `exists: false` rather
 * than as nothing: a plan that vanished is worth a word, and the alternative is
 * opening a different document than the person last asked for without saying so.
 */
export function readActivePlan(env = process.env, home = homedir()) {
  const pointer = activePointerPath(env, home);
  let text;
  try {
    text = readFileSync(pointer, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw new PlanLibraryError(`could not read ${pointer}: ${err.message}`);
  }
  const path = text.trim();
  if (!path) return null;
  return { path, exists: existsSync(path) };
}

export function writeActivePlan(path, env = process.env, home = homedir()) {
  const pointer = activePointerPath(env, home);
  mkdirSync(configDir(env, home), { recursive: true });
  writeFileSync(pointer, `${resolve(path)}\n`, "utf8");
  return pointer;
}

/** Forget the active plan, so `taltree` goes back to finding `./tree.yaml`. */
export function clearActivePlan(env = process.env, home = homedir()) {
  const pointer = activePointerPath(env, home);
  rmSync(pointer, { force: true });
  return pointer;
}

/**
 * Every plan file in the library, in name order, with what could be read of it.
 *
 * A file that will not parse still gets a row: the library is a directory a person
 * edits by hand, and a listing that hides the broken file is the listing that makes
 * the mistake hard to find.
 */
export function listPlans(directory, { active = null } = {}) {
  let names;
  try {
    names = readdirSync(directory);
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw new PlanLibraryError(`could not read ${directory}: ${err.message}`);
  }
  return names
    .filter((name) => !name.startsWith(".") && PLAN_EXTENSIONS.some((ext) => name.toLowerCase().endsWith(ext)))
    .sort((a, b) => a.localeCompare(b))
    .map((name) => {
      const path = join(directory, name);
      const entry = { name: shortName(name), file: name, path, active: active !== null && resolve(active) === resolve(path) };
      try {
        if (statSync(path).isDirectory()) return null;
        return { ...entry, ...describePlan(readFileSync(path, "utf8"), path) };
      } catch (err) {
        return { ...entry, readable: false, problem: err.message };
      }
    })
    .filter((entry) => entry !== null);
}

/** The name `taltree load` takes: the file name without its plan extension. */
export function shortName(fileName) {
  const lower = fileName.toLowerCase();
  const ext = PLAN_EXTENSIONS.find((candidate) => lower.endsWith(candidate));
  return ext ? fileName.slice(0, -ext.length) : fileName;
}

/**
 * Title, node count and group names, read out of a plan document.
 *
 * This is a summary for a listing, not the loader: the two builds own validation,
 * and duplicating their rules here would be a third place for them to drift.
 */
export function describePlan(text, path = "") {
  let data;
  try {
    data = path.toLowerCase().endsWith(".json") ? JSON.parse(text) : parse(text);
  } catch (err) {
    return { readable: false, problem: `not a readable plan file: ${err.message.split("\n")[0]}` };
  }
  if (typeof data !== "object" || data === null || !Array.isArray(data.nodes)) {
    return { readable: false, problem: "not a Taltree plan: no nodes list" };
  }
  const nodes = data.nodes.filter((node) => typeof node === "object" && node !== null);
  const groups = [];
  for (const node of nodes) {
    if (typeof node.group === "string" && node.group.trim() && !groups.includes(node.group)) {
      groups.push(node.group);
    }
  }
  return {
    readable: true,
    title: typeof data.title === "string" ? data.title : "",
    nodeCount: nodes.length,
    groups,
  };
}

/**
 * Turn what the person typed into a plan file to make active.
 *
 * A path wins over a library name: `taltree load ./tree.yaml` has to mean that file
 * even when a plan of the same name sits in the library.
 */
export function resolvePlanArgument(argument, { directory, cwd = process.cwd() } = {}) {
  if (!argument || !argument.trim()) {
    throw new PlanLibraryError("name a plan to load, or run `taltree plans` to see the library");
  }
  const asked = argument.trim();
  const looksLikePath =
    isAbsolute(asked) || asked.includes("/") || asked.includes(sep) || asked.startsWith(".");
  if (looksLikePath) {
    const path = resolve(cwd, asked);
    if (!existsSync(path)) throw new PlanLibraryError(`no plan file at ${path}`);
    return path;
  }
  const candidates = [asked, ...PLAN_EXTENSIONS.map((ext) => `${asked}${ext}`)];
  for (const candidate of candidates) {
    const path = join(directory, candidate);
    if (existsSync(path) && !statSync(path).isDirectory()) return path;
  }
  throw new PlanLibraryError(
    `no plan named "${asked}" in ${directory}. Run \`taltree plans\` to see what is there, or \`taltree import ${asked}\` to fetch it.`,
  );
}

/** The lines `taltree plans` prints. */
export function planListingLines(entries, directory) {
  if (entries.length === 0) {
    return [
      `No plans in ${directory} yet.`,
      "Run `taltree import <slug>` to fetch one, or copy a tree.yaml in there.",
    ];
  }
  const width = Math.max(...entries.map((entry) => entry.name.length));
  const lines = [`Plans in ${directory}:`, ""];
  for (const entry of entries) {
    const mark = entry.active ? "*" : " ";
    const detail = entry.readable
      ? `${String(entry.nodeCount).padStart(4)} ${plural(entry.nodeCount, "node")}${entry.groups.length > 0 ? `, ${entry.groups.length} ${plural(entry.groups.length, "group")}` : ""}${entry.title ? `  ${entry.title}` : ""}`
      : `       ${entry.problem}`;
    lines.push(`${mark} ${entry.name.padEnd(width)}  ${detail}`);
  }
  lines.push("");
  lines.push(
    entries.some((entry) => entry.active)
      ? "* is the active plan. `taltree load <name>` switches; `taltree load --none` goes back to ./tree.yaml."
      : "`taltree load <name>` makes one of these the plan `taltree` opens.",
  );
  return lines;
}

function plural(count, word) {
  return count === 1 ? word : `${word}s`;
}
