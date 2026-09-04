// Pure argument parsing for the taltree CLI. No side effects; unit-tested in cli.test.mjs.

export const DEFAULT_PORT = 5173;

export class CliError extends Error {}

/**
 * Parse argv (after `node script`) into launcher options.
 *
 * `taltree` runs the native terminal application, so the launcher owns only the few
 * arguments it can act on itself - the library commands, `update`, `help`, `--web`
 * and the web server's `--port`/`--no-open` - and passes everything else through
 * untouched. The Rust command line is the authority on its own options, which is why
 * an unrecognised option is forwarded rather than refused here, and `--` forwards the
 * rest verbatim so even `--help` or a plan file named `update` can reach it.
 *
 * A command is one exact first word, so `taltree plans/today.yaml` is still a path.
 *
 * Returns { command, ... } where the rest of the fields are the ones that command
 * acts on. Throws CliError on any input the launcher itself cannot act on.
 */
export function parseArgs(argv) {
  const args = [...argv];
  let command = "run";
  const first = args[0];
  if (LIBRARY_COMMANDS.has(first)) return parseLibraryArgs(args.shift(), args);
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

/** Commands the launcher answers itself, rather than forwarding to either build. */
const LIBRARY_COMMANDS = new Set(["import", "plans", "load"]);

/**
 * The plan-library commands, each parsed against only the options it acts on.
 *
 * These do not open a plan, so they carry none of the launcher's server options; a
 * `--port` here is a mistake worth naming rather than a value to carry around.
 */
function parseLibraryArgs(command, args) {
  if (args.includes("--help") || args.includes("-h")) {
    return { command: "help", port: DEFAULT_PORT, portExplicit: false, open: true, check: false, tuiArgs: [] };
  }
  if (command === "plans") {
    if (args.length > 0) throw new CliError(`\`taltree plans\` takes no arguments, but got "${args[0]}"`);
    return { command: "plans" };
  }
  if (command === "import") return parseImportArgs(args);
  return parseLoadArgs(args);
}

function parseImportArgs(args) {
  let slug = null;
  let force = false;
  let budget = null;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--force" || arg === "-f") {
      force = true;
    } else if (arg === "--budget" || arg.startsWith("--budget=")) {
      let value;
      if (arg === "--budget") {
        value = args[++i];
        if (value === undefined) throw new CliError("--budget requires a value");
      } else {
        value = arg.slice("--budget=".length);
      }
      budget = parseBudget(value);
    } else if (arg.startsWith("-")) {
      throw new CliError(`unknown option "${arg}" for \`taltree import\``);
    } else if (slug !== null) {
      throw new CliError("one roadmap at a time, please");
    } else {
      slug = arg;
    }
  }
  if (slug === null) {
    throw new CliError("`taltree import` needs a roadmap slug, like `taltree import frontend`");
  }
  return { command: "import", slug, force, budget };
}

function parseLoadArgs(args) {
  let plan = null;
  let clear = false;
  for (const arg of args) {
    if (arg === "--none" || arg === "--clear") {
      clear = true;
    } else if (arg.startsWith("-")) {
      throw new CliError(`unknown option "${arg}" for \`taltree load\``);
    } else if (plan !== null) {
      throw new CliError("one plan at a time, please");
    } else {
      plan = arg;
    }
  }
  if (clear && plan !== null) {
    throw new CliError(`\`taltree load --none\` clears the active plan, so it takes no plan name`);
  }
  if (!clear && plan === null) {
    throw new CliError("`taltree load` needs a plan name; run `taltree plans` to see the library");
  }
  return { command: "load", plan, clear };
}

function parseBudget(value) {
  if (!/^\d+$/.test(value)) throw new CliError(`invalid budget "${value}"`);
  const budget = Number(value);
  if (budget < 0 || budget > 99) throw new CliError(`budget out of range (0-99): ${budget}`);
  return budget;
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
  taltree plans                   List the plans in your library
  taltree load <plan>             Make a plan the one taltree opens
  taltree import <slug>           Fetch a roadmap.sh roadmap into your library
  taltree update [--check]        Update to the latest version from origin
  taltree --help                  Show this help

The terminal application is the default. Any option this launcher does not
recognise - and everything after \`--\` - is passed to it unchanged, so
\`taltree -e\`, \`taltree ./plans/today.yaml\` and \`taltree -- --help\` all work.
A command is one exact first word, so a path is never mistaken for one.

Options:
  --web           Run the browser build's Vite dev server instead
  --port <port>   With --web: dev server port (default: ${DEFAULT_PORT}; next free port if busy)
  --no-open       With --web: do not open the browser once the server is ready
  --check         With update: report whether an update exists, change nothing
  --none          With load: forget the active plan and go back to ./tree.yaml
  --force         With import: overwrite a plan of that name already in the library
  --budget <n>    With import: daily budget for the imported plan (default: 8)

\`taltree import\` fetches one roadmap from roadmap.sh's public API, on your
request, onto your machine. It writes the node titles and their drawn edges and
nothing else; roadmap.sh's topic text is theirs, and Taltree neither ships it nor
fetches it.
`;
}
