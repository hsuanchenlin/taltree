// Writing a plan file without ever leaving a half-written one behind.
//
// The same rule as `tui/src/persist/store.rs`: write a temporary file beside the
// target and rename it into place, so an interrupted write leaves the previous plan
// intact rather than a truncated one. `taltree import --force` replaces a plan a
// person may already be part-way through, which is exactly when that matters.

import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export function writeAtomically(path, contents) {
  const directory = dirname(path);
  mkdirSync(directory, { recursive: true });
  const temporary = join(directory, `.${pathName(path)}.${process.pid}.tmp`);
  writeFileSync(temporary, contents, "utf8");
  try {
    renameSync(temporary, path);
  } catch (err) {
    rmSync(temporary, { force: true });
    throw err;
  }
}

function pathName(path) {
  return path.slice(dirname(path).length + 1) || "tree.yaml";
}
