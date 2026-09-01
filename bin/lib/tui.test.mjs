import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { binaryPath, buildArgs, installArgs, manifestPath, cratePath, runTui, TuiError } from "./tui.mjs";

const ROOT = "/install/taltree";
const BINARY = join(ROOT, "tui", "target", "release", "taltree");

describe("paths and cargo arguments", () => {
  it("points at the crate's release binary", () => {
    expect(binaryPath(ROOT, "darwin")).toBe(BINARY);
    expect(binaryPath(ROOT, "linux")).toBe(BINARY);
    expect(binaryPath(ROOT, "win32")).toBe(join(ROOT, "tui", "target", "release", "taltree.exe"));
  });

  it("builds the binary the launcher then runs", () => {
    expect(buildArgs(ROOT)).toEqual(["build", "--release", "--manifest-path", manifestPath(ROOT)]);
  });

  it("installs from the crate directory, forcing over an existing binary", () => {
    // Without --force cargo skips an install whose version already matches, which
    // would leave an out-of-date binary on the PATH after an update.
    expect(installArgs(ROOT)).toEqual(["install", "--path", cratePath(ROOT), "--force"]);
  });
});

describe("runTui", () => {
  const spy = () => {
    const calls = [];
    return [calls, (...args) => (calls.push(args), 0)];
  };

  it("runs the existing binary with the arguments unchanged, and never builds", async () => {
    const [built, build] = spy();
    const [ran, run] = spy();
    const code = await runTui({
      root: ROOT,
      args: ["--empty", "plans/today.yaml"],
      platform: "linux",
      exists: () => true,
      build,
      run,
      out: () => {},
    });
    expect(code).toBe(0);
    expect(built).toEqual([]);
    expect(ran).toEqual([[BINARY, ["--empty", "plans/today.yaml"], expect.anything()]]);
  });

  it("returns the application's own exit code", async () => {
    const code = await runTui({
      root: ROOT,
      platform: "linux",
      exists: () => true,
      run: () => 3,
      out: () => {},
    });
    expect(code).toBe(3);
  });

  it("builds once when the binary is missing, then runs it", async () => {
    const [built, build] = spy();
    const [ran, run] = spy();
    const present = new Set([manifestPath(ROOT)]);
    const messages = [];
    await runTui({
      root: ROOT,
      platform: "linux",
      exists: (path) => present.has(path),
      build: (...args) => (build(...args), present.add(BINARY), 0),
      run,
      out: (message) => messages.push(message),
    });
    expect(built).toEqual([["cargo", buildArgs(ROOT), expect.objectContaining({ cwd: ROOT })]]);
    expect(ran).toEqual([[BINARY, [], expect.anything()]]);
    expect(messages.join("\n")).toContain("building");
  });

  it("names rustup when cargo is not installed", async () => {
    const build = () => {
      throw new TuiError("cargo was not found, and it is needed to build the terminal application. See https://rustup.rs");
    };
    await expect(
      runTui({
        root: ROOT,
        platform: "linux",
        exists: (path) => path === manifestPath(ROOT),
        build,
        run: () => 0,
        out: () => {},
      }),
    ).rejects.toThrow(/rustup\.rs/);
  });

  it("reports a failed build instead of running a stale or absent binary", async () => {
    const [ran, run] = spy();
    await expect(
      runTui({
        root: ROOT,
        platform: "linux",
        exists: (path) => path === manifestPath(ROOT),
        build: () => 101,
        run,
        out: () => {},
      }),
    ).rejects.toThrow(TuiError);
    expect(ran).toEqual([]);
  });

  it("reports a build that claims success but produced nothing", async () => {
    await expect(
      runTui({
        root: ROOT,
        platform: "linux",
        exists: (path) => path === manifestPath(ROOT),
        build: () => 0,
        run: () => 0,
        out: () => {},
      }),
    ).rejects.toThrow(/is missing/);
  });

  it("says the source is absent when there is no crate to build", async () => {
    await expect(
      runTui({ root: ROOT, platform: "linux", exists: () => false, build: () => 0, run: () => 0, out: () => {} }),
    ).rejects.toThrow(/reinstall taltree/);
  });
});
