#!/usr/bin/env node
// taltree CLI: `taltree` launches the dev server and opens the browser;
// `taltree update` fast-forwards this checkout and reinstalls dependencies.

import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, helpText, CliError } from "./lib/cli.mjs";
import { isPortFree, findFreePort, waitForServer, openBrowser } from "./lib/server.mjs";
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

  let chosen = port;
  if (portExplicit) {
    if (!(await isPortFree(port))) fail(`port ${port} is already in use`);
  } else {
    chosen = await findFreePort(port);
  }
  const url = `http://localhost:${chosen}`;

  const child = spawn(viteBin, ["--port", String(chosen), "--strictPort"], {
    cwd: packageRoot,
    stdio: ["ignore", "inherit", "inherit"],
  });

  let stopping = false;
  const stop = (code) => {
    if (stopping) return;
    stopping = true;
    if (!child.killed) child.kill("SIGTERM");
    const killer = setTimeout(() => child.kill("SIGKILL"), 3000);
    killer.unref();
    child.once("exit", () => process.exit(code));
  };
  process.on("SIGINT", () => stop(0));
  process.on("SIGTERM", () => stop(0));
  child.on("exit", (code) => {
    if (!stopping) process.exit(code ?? 0);
  });

  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("data", (key) => {
      const k = key.toString();
      if (k === "q" || k === "\x03") stop(0);
    });
  }

  console.log(`taltree: starting dev server on ${url}`);
  try {
    await waitForServer(url);
  } catch {
    console.error("taltree: dev server did not become ready; see the output above");
    stop(1);
    return;
  }
  console.log(`taltree: server ready at ${url} - press q or Ctrl-C to stop`);
  if (open) {
    console.log("taltree: opening in your browser");
    openBrowser(url);
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
