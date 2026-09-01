// Launching the native Rust terminal application, which is what `taltree` runs.
//
// The compiled binary lives in the crate's own release directory, so a checkout that
// has never been built has nothing to run; the launcher builds it once, in view, rather
// than telling the person to go and do it. Every rule here is injectable so the whole
// path is unit-tested in tui.test.mjs without a Rust toolchain.

import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";

export class TuiError extends Error {}

export const NATIVE_BINARY_NAME = "taltree-tui";

/** Directory of the Rust crate inside an install root. */
export function cratePath(root) {
  return join(root, "tui");
}

/** Cargo manifest of the terminal application. */
export function manifestPath(root) {
  return join(cratePath(root), "Cargo.toml");
}

/** The compiled release binary. Windows names it with an `.exe` suffix. */
export function binaryPath(root, platform = process.platform) {
  const executable = platform === "win32" ? `${NATIVE_BINARY_NAME}.exe` : NATIVE_BINARY_NAME;
  return join(cratePath(root), "target", "release", executable);
}

/** Arguments that build the release binary `binaryPath` names. */
export function buildArgs(root) {
  return ["build", "--release", "--manifest-path", manifestPath(root)];
}

/**
 * Arguments that put the terminal application on the PATH.
 * `--force` is deliberate: without it cargo skips an install whose version already
 * matches, so an update that changed code but not the version number would leave the
 * old binary in cargo's bin directory and quietly undo the update.
 */
export function installArgs(root) {
  return ["install", "--path", cratePath(root), "--bin", NATIVE_BINARY_NAME, "--force"];
}

/** What to say when `cargo` itself is missing; `action` completes "cargo is needed to ...". */
export function cargoMissingMessage(action) {
  return `cargo was not found, and it is needed to ${action}. Install a Rust toolchain from https://rustup.rs (or run \`taltree --web\` for the browser build).`;
}

/**
 * Run a command with the terminal handed straight to it. `stdio: "inherit"` is what
 * lets the Rust application take raw mode, read key events, and paint ANSI itself:
 * piping any of the three would leave it drawing into a buffer nobody sees.
 */
function runInherited(command, args, { cwd, missing } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: "inherit" });
    child.on("error", (error) => {
      reject(error.code === "ENOENT" && missing ? new TuiError(missing) : error);
    });
    child.on("exit", (code, signal) => resolve(signal ? 1 : (code ?? 0)));
  });
}

/**
 * Hand the terminal to the application and wait for it to exit.
 *
 * The launcher stops reacting to signals for the duration: in raw mode Ctrl-C is a key
 * event the application handles, and a launcher that died on it would leave the terminal
 * in raw mode with the alternate screen still up. SIGTERM is forwarded instead, so the
 * application still gets to restore the terminal on its way out.
 */
function spawnAttached(binary, args, { missing } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: "inherit" });
    const ignore = () => {};
    const forward = () => {
      if (!child.killed) child.kill("SIGTERM");
    };
    process.on("SIGINT", ignore);
    process.on("SIGTERM", forward);
    const release = () => {
      process.off("SIGINT", ignore);
      process.off("SIGTERM", forward);
    };
    child.on("error", (error) => {
      release();
      reject(error.code === "ENOENT" && missing ? new TuiError(missing) : error);
    });
    child.on("exit", (code, signal) => {
      release();
      resolve(signal ? 1 : (code ?? 0));
    });
  });
}

/**
 * Build the release binary if it is not there yet, then run it with `args` and resolve
 * with its exit code. A missing crate or a missing toolchain is reported as a TuiError
 * carrying a user-facing message; anything else propagates.
 */
export async function runTui({
  root,
  args = [],
  platform = process.platform,
  exists = existsSync,
  build = (command, commandArgs, options) => runInherited(command, commandArgs, options),
  run = spawnAttached,
  out = (message) => console.log(message),
}) {
  const binary = binaryPath(root, platform);
  if (!exists(binary)) {
    if (!exists(manifestPath(root))) {
      throw new TuiError(
        `the terminal application is not built and its source is not in ${root}; reinstall taltree from the repository (see README).`,
      );
    }
    out("taltree: building the terminal application (first run only)...");
    const code = await build("cargo", buildArgs(root), {
      cwd: root,
      missing: cargoMissingMessage("build the terminal application"),
    });
    if (code !== 0) throw new TuiError(`building the terminal application failed (cargo exited with ${code}).`);
    if (!exists(binary)) throw new TuiError(`cargo reported success but ${binary} is missing.`);
  }
  return run(binary, args, { missing: `${binary} disappeared before it could be started; run \`taltree update\` to rebuild it.` });
}
