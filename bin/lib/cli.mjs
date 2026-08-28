// Pure argument parsing for the taltree CLI. No side effects; unit-tested in cli.test.mjs.

export const DEFAULT_PORT = 5173;

export class CliError extends Error {}

/**
 * Parse argv (after `node script`) into launcher options.
 * Returns { command: "run" | "update" | "help", port, portExplicit, check }.
 * Throws CliError on any invalid input.
 */
export function parseArgs(argv) {
  const args = [...argv];
  let command = "run";
  const first = args[0];
  if (first === "run" || first === "update" || first === "help") {
    command = args.shift();
  } else if (first !== undefined && !first.startsWith("-")) {
    throw new CliError(`unknown command "${first}"`);
  }

  let port = DEFAULT_PORT;
  let portExplicit = false;
  let check = false;
  let open = true;
  let help = command === "help";

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (arg === "--no-open") {
      if (command === "update") throw new CliError("--no-open only applies to `taltree run`");
      open = false;
    } else if (arg === "--port" || arg.startsWith("--port=")) {
      if (command === "update") throw new CliError("--port only applies to `taltree run`");
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
    } else if (arg.startsWith("-")) {
      throw new CliError(`unknown option "${arg}"`);
    } else {
      throw new CliError(`unexpected argument "${arg}"`);
    }
  }

  if (help) return { command: "help", port, portExplicit, check, open };
  return { command, port, portExplicit, check, open };
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
  taltree [run] [--port <port>]   Start the app and open it in your browser
  taltree update [--check]        Update to the latest version from origin
  taltree --help                  Show this help

Options:
  --port <port>   Dev server port (default: ${DEFAULT_PORT}; next free port if busy)
  --no-open       Do not open the browser after the server is ready
  --check         With update: report whether an update exists, change nothing
`;
}
