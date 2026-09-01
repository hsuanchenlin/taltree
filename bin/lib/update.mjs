// `taltree update`: fetch origin, report status, fast-forward pull, then rebuild both
// builds - the terminal application `taltree` runs, and the browser build behind --web.
// Never mutates working-tree state before a fetch succeeds; pull is --ff-only.

import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { buildArgs, installArgs, cargoMissingMessage } from "./tui.mjs";

const execFileAsync = promisify(execFile);

export class UpdateError extends Error {}

async function git(root, args) {
  const { stdout } = await execFileAsync("git", ["-C", root, ...args]);
  return stdout.trim();
}

function runVisible(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited with ${code}`))));
  });
}

/** True when a failed run means the program itself was not on the PATH. */
function notInstalled(error) {
  return error?.code === "ENOENT";
}

/** Pure status line; unit-tested in update.test.mjs. */
export function describeStatus({ ahead, behind, current, incoming }) {
  if (behind === 0) {
    return ahead === 0
      ? `Already up to date (${current}).`
      : `Up to date with origin; ${ahead} local commit(s) not yet pushed (${current}).`;
  }
  return `Update available: ${behind} new commit(s), ${current} -> ${incoming}.`;
}

/**
 * Update the checkout at `root`. With `check`, only reports. Returns { updated, ahead, behind }.
 * Throws UpdateError with a user-facing message on any failure.
 */
export async function update({ root, check = false, out = (m) => console.log(m), run = runVisible }) {
  try {
    await git(root, ["rev-parse", "--is-inside-work-tree"]);
  } catch {
    throw new UpdateError(
      `${root} is not a git checkout; update by re-running the global install from the taltree repository (see README).`,
    );
  }

  const before = await git(root, ["log", "-1", "--oneline"]);
  out(`Current: ${before}`);

  try {
    await git(root, ["fetch", "--quiet", "origin"]);
  } catch {
    throw new UpdateError("could not reach origin; check your network connection and retry. Nothing was changed.");
  }

  let upstream;
  try {
    upstream = await git(root, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]);
  } catch {
    throw new UpdateError("current branch has no upstream; set one and retry. Nothing was changed.");
  }

  const counts = await git(root, ["rev-list", "--left-right", "--count", `HEAD...${upstream}`]);
  const [ahead, behind] = counts.split(/\s+/).map(Number);
  const current = await git(root, ["rev-parse", "--short", "HEAD"]);
  const incoming = await git(root, ["rev-parse", "--short", upstream]);
  out(describeStatus({ ahead, behind, current, incoming }));

  if (check) return { updated: false, ahead, behind };

  let after = before;
  if (behind > 0) {
    try {
      await git(root, ["pull", "--ff-only"]);
    } catch {
      throw new UpdateError(
        "git pull --ff-only failed (diverged branch or conflicting local changes); repository left unchanged. Resolve it and retry.",
      );
    }
    after = await git(root, ["log", "-1", "--oneline"]);
    out(`Pulled: ${after}`);
  }

  // The terminal application comes first: it is what `taltree` runs, so a failure here
  // must be reported before the browser build's dependencies are touched.
  out("Building the terminal application (cargo build --release)...");
  try {
    await run("cargo", buildArgs(root), root);
  } catch (error) {
    throw new UpdateError(
      notInstalled(error)
        ? cargoMissingMessage("build the terminal application")
        : "cargo build --release failed; the repository is updated but the terminal application was not rebuilt.",
    );
  }

  out("Installing the terminal application as taltree-tui (cargo install --path tui)...");
  try {
    await run("cargo", installArgs(root), root);
  } catch (error) {
    throw new UpdateError(
      notInstalled(error)
        ? cargoMissingMessage("install the terminal application")
        : "cargo install --path tui failed; the binary in tui/target/release is current, but cargo's bin directory was not updated.",
    );
  }

  out("Installing browser-build dependencies (npm install)...");
  try {
    await run("npm", ["install"], root);
  } catch {
    throw new UpdateError("npm install failed; retry taltree update.");
  }

  if (behind > 0) out(`Updated: ${before} -> ${after}`);
  else out(`Rebuilt and reinstalled; repository remains at ${current}.`);
  return { updated: behind > 0, ahead, behind };
}
