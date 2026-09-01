import { describe, it, expect } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describeStatus, update, UpdateError } from "./update.mjs";
import { buildArgs, installArgs } from "./tui.mjs";

const run = promisify(execFile);

describe("describeStatus", () => {
  it("reports up to date when nothing is behind", () => {
    expect(describeStatus({ ahead: 0, behind: 0, current: "aaa1111", incoming: "aaa1111" })).toBe(
      "Already up to date (aaa1111).",
    );
  });

  it("notes unpushed local commits without claiming an update", () => {
    expect(describeStatus({ ahead: 2, behind: 0, current: "aaa1111", incoming: "aaa1111" })).toContain(
      "2 local commit(s) not yet pushed",
    );
  });

  it("announces available updates with before and after commits", () => {
    const line = describeStatus({ ahead: 0, behind: 3, current: "aaa1111", incoming: "bbb2222" });
    expect(line).toContain("3 new commit(s)");
    expect(line).toContain("aaa1111 -> bbb2222");
  });
});

/** A checkout with an origin it is already up to date with, so update only rebuilds. */
async function checkoutWithUpstream() {
  const base = await mkdtemp(join(tmpdir(), "taltree-update-"));
  const origin = join(base, "origin");
  const clone = join(base, "clone");
  await mkdir(origin, { recursive: true });
  await run("git", ["init", "--quiet", "--bare", "--initial-branch=main", origin]);
  const work = join(base, "work");
  await mkdir(work, { recursive: true });
  await run("git", ["init", "--quiet", "--initial-branch=main", work]);
  await writeFile(join(work, "README.md"), "taltree\n");
  const git = (cwd, args) => run("git", ["-C", cwd, ...args]);
  await git(work, ["config", "user.email", "test@example.com"]);
  await git(work, ["config", "user.name", "Test"]);
  await git(work, ["add", "."]);
  await git(work, ["commit", "--quiet", "-m", "first"]);
  await git(work, ["remote", "add", "origin", origin]);
  await git(work, ["push", "--quiet", "origin", "main"]);
  await run("git", ["clone", "--quiet", origin, clone]);
  return clone;
}

describe("update", () => {
  it("builds and installs the terminal application before the browser build", async () => {
    const root = await checkoutWithUpstream();
    const commands = [];
    const result = await update({
      root,
      out: () => {},
      run: (cmd, args) => commands.push([cmd, args]),
    });
    expect(result).toMatchObject({ updated: false, behind: 0 });
    expect(commands).toEqual([
      ["cargo", buildArgs(root)],
      ["cargo", installArgs(root)],
      ["npm", ["install"]],
    ]);
  });

  it("skips every build with --check", async () => {
    const root = await checkoutWithUpstream();
    const commands = [];
    await update({ root, check: true, out: () => {}, run: (cmd, args) => commands.push([cmd, args]) });
    expect(commands).toEqual([]);
  });

  it("points at rustup when cargo is not installed", async () => {
    const root = await checkoutWithUpstream();
    const missing = Object.assign(new Error("spawn cargo ENOENT"), { code: "ENOENT" });
    await expect(
      update({
        root,
        out: () => {},
        run: (cmd) => {
          if (cmd === "cargo") throw missing;
        },
      }),
    ).rejects.toThrow(/rustup\.rs/);
  });

  it("stops at a failed cargo build rather than reporting an update", async () => {
    const root = await checkoutWithUpstream();
    const commands = [];
    await expect(
      update({
        root,
        out: () => {},
        run: (cmd, args) => {
          commands.push([cmd, args]);
          if (cmd === "cargo") throw new Error("cargo exited with 101");
        },
      }),
    ).rejects.toThrow(UpdateError);
    expect(commands.map(([cmd]) => cmd)).toEqual(["cargo"]);
  });

  it("refuses a directory that is not a git checkout", async () => {
    const root = await mkdtemp(join(tmpdir(), "taltree-not-git-"));
    await expect(update({ root, out: () => {}, run: () => {} })).rejects.toThrow(/not a git checkout/);
  });
});
