#!/usr/bin/env node
// taltree CLI: `taltree` launches the dev server and opens the browser;
// `taltree update` fast-forwards this checkout and reinstalls dependencies.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, helpText, CliError } from "./lib/cli.mjs";
import { SERVER_HOST, isPortFree, findFreePort, isPortInUseError, spawnDevServer, openBrowser } from "./lib/server.mjs";
import { update, UpdateError } from "./lib/update.mjs";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));

function fail(message, code = 1) {
  console.error(`taltree: ${message}`);
  process.exit(code);
}

async function launch({ port, portExplicit, open }) {
  const viteBin = join(packageRoot, "node_modules", ".bin", "vite");
  if (!existsSync(viteBin)) {
    fail(`dependencies are not installed; run \`npm install\` in ${packageRoot}`);
  }

  let current = null;
  let stopping = false;
  const stop = (code) => {
    if (stopping) return;
    stopping = true;
    const child = current?.child;
    if (!child || child.exitCode !== null) process.exit(code);
    if (!child.killed) child.kill("SIGTERM");
    const killer = setTimeout(() => child.kill("SIGKILL"), 3000);
    killer.unref();
    child.once("exit", () => process.exit(code));
  };
  process.on("SIGINT", () => stop(0));
  process.on("SIGTERM", () => stop(0));

  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("data", (key) => {
      const k = key.toString();
      if (k === "q" || k === "\x03") stop(0);
    });
  }

  // A port probed free can still lose the bind race, so non-explicit ports
  // retry on the next candidate; an explicit port failure is reported instead.
  let preferred = port;
  for (;;) {
    if (portExplicit && !(await isPortFree(port))) fail(`port ${port} is already in use`);
    const chosen = portExplicit ? port : await findFreePort(preferred);
    const url = `http://${SERVER_HOST}:${chosen}`;

    console.log(`taltree: starting dev server on ${url}`);
    current = spawnDevServer(viteBin, { cwd: packageRoot, port: chosen });
    const outcome = await current.waitUntilReady(url);
    if (stopping) return;

    if (outcome.ready) {
      console.log(`taltree: server ready at ${url} - press q or Ctrl-C to stop`);
      if (open) {
        console.log("taltree: opening in your browser");
        openBrowser(url);
      }
      const code = await current.exited;
      if (!stopping) process.exit(code ?? 0);
      return;
    }

    if (outcome.timedOut) {
      console.error("taltree: dev server did not become ready; see the output above");
      stop(1);
      return;
    }

    const bindFailed = isPortInUseError(current.stderr);
    if (portExplicit) {
      fail(
        bindFailed
          ? `port ${port} is already in use`
          : `dev server exited with code ${outcome.code} before becoming ready`,
      );
    }
    if (!bindFailed) process.exit(outcome.code ?? 1);
    console.error(`taltree: port ${chosen} was taken before the server could bind; trying the next port`);
    preferred = chosen + 1;
  }
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    if (err instanceof CliError) {
      console.error(`taltree: ${err.message}\n`);
      console.error(helpText());
      process.exit(2);
    }
    throw err;
  }

  if (opts.command === "help") {
    console.log(helpText());
    return;
  }

  if (opts.command === "update") {
    try {
      await update({ root: packageRoot, check: opts.check });
    } catch (err) {
      if (err instanceof UpdateError) fail(err.message);
      throw err;
    }
    return;
  }

  await launch(opts);
}

main();
