// Pure argument parsing for the taltree CLI. No side effects; unit-tested in cli.test.mjs.

export const DEFAULT_PORT = 5173;

export class CliError extends Error {}

/**
 * Parse argv (after `node script`) into launcher options.
 *
 * `taltree` runs the native terminal application, so the launcher owns only the few
 * arguments it can act on itself - `update`, `help`, `--web` and the web server's
 * `--port`/`--no-open` - and passes everything else through untouched. The Rust
 * command line is the authority on its own options, which is why an unrecognised
 * option is forwarded rather than refused here, and `--` forwards the rest verbatim
 * so even `--help` or a plan file named `update` can reach it.
 *
 * Returns { command: "tui" | "web" | "update" | "help", port, portExplicit, open,
 * check, tuiArgs }.
 * Throws CliError on any input the launcher itself cannot act on.
 */
export function parseArgs(argv) {
  const args = [...argv];
  let command = "run";
  const first = args[0];
  if (first === "run" || first === "update" || first === "help") {
    command = args.shift();
  }

  let port = DEFAULT_PORT;
  let portExplicit = false;
  let check = false;
  let open = true;
  let web = false;
  let help = command === "help";
  let forwarding = false;
  const tuiArgs = [];

  const launcherOnly = (option) => {
    if (command === "update") throw new CliError(`${option} does not apply to \`taltree update\``);
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (forwarding) {
      tuiArgs.push(arg);
    } else if (arg === "--") {
      launcherOnly("--");
      forwarding = true;
    } else if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (arg === "--web") {
      launcherOnly("--web");
      web = true;
    } else if (arg === "--no-open") {
      launcherOnly("--no-open");
      open = false;
    } else if (arg === "--port" || arg.startsWith("--port=")) {
      launcherOnly("--port");
      let value;
      if (arg === "--port") {
        value = args[++i];
        if (value === undefined) throw new CliError("--port requires a value");
      } else {
        value = arg.slice("--port=".length);
      }
      port = parsePort(value);
      portExplicit = true;
    } else if (arg === "--check") {
      if (command !== "update") throw new CliError("--check only applies to `taltree update`");
      check = true;
    } else if (command === "update") {
      throw new CliError(`unexpected argument "${arg}"`);
    } else {
      tuiArgs.push(arg);
    }
  }

  if (help) return { command: "help", port, portExplicit, open, check, tuiArgs: [] };

  if (!web) {
    if (portExplicit) throw new CliError("--port only applies to `taltree --web`");
    if (!open) throw new CliError("--no-open only applies to `taltree --web`");
  } else if (tuiArgs.length > 0) {
    throw new CliError(`\`taltree --web\` takes no plan file, but got "${tuiArgs[0]}"`);
  }

  if (command === "run") command = web ? "web" : "tui";
  return { command, port, portExplicit, open, check, tuiArgs };
}

function parsePort(value) {
  if (!/^\d+$/.test(value)) throw new CliError(`invalid port "${value}"`);
  const port = Number(value);
  if (port < 1 || port > 65535) throw new CliError(`port out of range (1-65535): ${port}`);
  return port;
}

export function helpText() {
  return `taltree - local-first daily-budget planner

Usage:
  taltree [options] [path]        Open a plan in the terminal application
  taltree --web [--port <port>]   Start the browser build's dev server instead
  taltree update [--check]        Update to the latest version from origin
  taltree --help                  Show this help

The terminal application is the default. Any option this launcher does not
recognise - and everything after \`--\` - is passed to it unchanged, so
\`taltree -e\`, \`taltree plans/today.yaml\` and \`taltree -- --help\` all work.

Options:
  --web           Run the browser build's Vite dev server instead
  --port <port>   With --web: dev server port (default: ${DEFAULT_PORT}; next free port if busy)
  --no-open       With --web: do not open the browser once the server is ready
  --check         With update: report whether an update exists, change nothing
`;
}
