// Process-lifecycle helpers for the taltree launcher: the pidfile that records the
// running dev server, and the reclaim path that frees a port still held by a stale
// instance of this installation.
//
// A launcher killed with SIGKILL (a closed terminal, a crashed shell) leaves its Vite
// child reparented to init and still holding the port, so the next launch would step
// aside to 5174 forever. The pidfile is what makes that orphan identifiable: the port
// alone says nothing about who owns it, and the process table alone cannot tell a stale
// server from a live one belonging to somebody else.

import { mkdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, sep } from "node:path";

/** Directory, relative to the install root, holding the pidfiles. */
export const PIDFILE_DIR = ".taltree";

/**
 * Pidfile for one port. One file per port so two concurrent launchers on
 * different ports cannot overwrite or delete each other's record.
 */
export function pidfilePath(root, port) {
  return join(root, PIDFILE_DIR, `server-${port}.pid`);
}

/** Trailing-separator-insensitive form of an install root, for path comparisons. */
function normalizeRoot(root) {
  if (typeof root !== "string" || root === "") return null;
  let normalized = root;
  while (normalized.length > 1 && normalized.endsWith(sep)) normalized = normalized.slice(0, -1);
  return normalized;
}

function positivePid(value) {
  const pid = Number(value);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

/** Write the record for a running server. Creates the pidfile directory as needed. */
export function writePidfile(path, record, { write = writeFileSync, mkdir = mkdirSync } = {}) {
  mkdir(dirname(path), { recursive: true });
  write(path, `${JSON.stringify(record, null, 2)}\n`);
}

/**
 * Read a pidfile record, or null when it is missing, unreadable, malformed, or
 * lacks a usable server pid. A damaged pidfile must never be fatal: the worst it
 * may do is make the launcher treat the port as somebody else's.
 */
export function readPidfile(path, { read = readFileSync } = {}) {
  let raw;
  try {
    raw = read(path, "utf8");
  } catch {
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const serverPid = positivePid(parsed.serverPid);
  const pid = positivePid(parsed.pid);
  if (serverPid === null && pid === null) return null;
  return {
    pid,
    serverPid: serverPid ?? pid,
    port: positivePid(parsed.port),
    root: typeof parsed.root === "string" ? parsed.root : null,
    startedAt: typeof parsed.startedAt === "string" ? parsed.startedAt : null,
  };
}

/**
 * Remove a pidfile. With `ownerPid`, only removes a record that names that launcher,
 * so an exiting instance cannot delete a record another instance has since written.
 */
export function removePidfile(path, { ownerPid = null, read = readFileSync, remove = unlinkSync } = {}) {
  if (ownerPid !== null) {
    const record = readPidfile(path, { read });
    if (record && record.pid !== null && record.pid !== ownerPid) return false;
  }
  try {
    remove(path);
    return true;
  } catch {
    return false;
  }
}

/** True when `pid` names a live process. EPERM means alive but owned by somebody else. */
export function isProcessAlive(pid, { kill = process.kill.bind(process) } = {}) {
  if (positivePid(pid) === null) return false;
  try {
    kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === "EPERM";
  }
}

/** The full command line of `pid`, or null when it cannot be read (gone, or no `ps`). */
export function readProcessCommand(pid, { run = psCommand } = {}) {
  if (positivePid(pid) === null) return null;
  try {
    const command = run(pid);
    return typeof command === "string" && command.trim() !== "" ? command.trim() : null;
  } catch {
    return null;
  }
}

/**
 * The parent pid of `pid`, or null when it cannot be read. A dev server whose parent
 * is no longer its launcher has been reparented to init: that is what makes it an orphan.
 */
export function readProcessParent(pid, { run = psParent } = {}) {
  if (positivePid(pid) === null) return null;
  try {
    return positivePid(run(pid));
  } catch {
    return null;
  }
}

function psField(pid, field) {
  // stderr is discarded: `ps` complains about a pid that is simply gone, which is
  // an answer ("not ours"), not something the launcher should print.
  return execFileSync("ps", ["-o", `${field}=`, "-p", String(pid)], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
}

function psParent(pid) {
  return psField(pid, "ppid").trim();
}

function psCommand(pid) {
  return psField(pid, "command");
}

/** Program names the launcher may terminate, when they run out of the install root. */
const OWN_PROGRAMS = new Set(["vite", "vite.js", "vite.mjs", "vite.cmd", "taltree", "taltree.mjs", "taltree.cmd"]);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * True when a command line belongs to this installation's launcher or dev server.
 * The test is one argument that is *both* under the install root and named like our
 * launcher or Vite: the root alone would match any program merely pointed at this
 * checkout (`postgres -D <root>/data`), and the name alone would match another
 * taltree. Anything we cannot positively identify is left alone.
 */
export function isOwnProcess(command, { root, platform = process.platform } = {}) {
  if (typeof command !== "string" || command.trim() === "") return false;
  const normalizedRoot = normalizeRoot(root);
  if (normalizedRoot === null) return false;
  const portableCommand = command.replaceAll("\\", "/");
  const portableRoot = normalizedRoot.replaceAll("\\", "/");
  const directories = ["node_modules/.bin", "node_modules/vite/bin", "bin"];
  const flags = platform === "win32" || platform === "darwin" ? "i" : "";
  return directories.some((directory) =>
    [...OWN_PROGRAMS].some((program) => {
      const path = `${portableRoot}/${directory}/${program}`;
      return new RegExp(`(?:^|[\"'\\s])${escapeRegExp(path)}(?=[\"'\\s]|$)`, flags).test(portableCommand);
    }),
  );
}

function commandUsesPort(command, port) {
  if (typeof command !== "string") return false;
  return new RegExp(`(?:^|\\s)--port(?:=|\\s+)${port}(?=\\s|$)`).test(command);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Poll until `port` is free or the deadline passes. */
async function waitForPortFree(port, { isPortFree, timeoutMs, intervalMs, wait }) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await isPortFree(port)) return true;
    if (Date.now() >= deadline) return false;
    await wait(intervalMs);
  }
}

/**
 * Free `port` when a stale instance of this installation still holds it.
 *
 * Returns `{ outcome, pid }` where outcome is one of:
 * - `free` - nothing held the port.
 * - `reclaimed` - our orphaned server was terminated and the port is free again.
 * - `live-instance` - another launcher of this installation is still supervising its
 *   server; it is not stale, so it is left running and the caller steps aside.
 * - `foreign` - the port is held by something this installation does not own; untouched.
 * - `stale-pidfile` - the recorded process is gone (so the port is somebody else's);
 *   the leftover pidfile was removed.
 * - `unreclaimed` - our server survived SIGTERM and SIGKILL; treat the port as taken.
 *
 * Only an orphan is reclaimed: a server whose launcher is gone (killed terminal, crashed
 * shell) but which still holds the port. A server with a live launcher belongs to a
 * session somebody is using, and killing that would trade one surprise for a worse one.
 *
 * Termination escalates SIGTERM -> SIGKILL, and success is judged by the port actually
 * coming free rather than by the signal being delivered.
 */
export async function reclaimPort({
  root,
  port,
  isPortFree,
  readRecord = readPidfile,
  removeRecord = removePidfile,
  isAlive = isProcessAlive,
  commandOf = readProcessCommand,
  parentOf = readProcessParent,
  kill = process.kill.bind(process),
  wait = sleep,
  selfPid = process.pid,
  termTimeoutMs = 3000,
  killTimeoutMs = 2000,
  pollIntervalMs = 100,
}) {
  if (await isPortFree(port)) return { outcome: "free", pid: null };

  const path = pidfilePath(root, port);
  const record = readRecord(path);
  if (!record || (record.port !== null && record.port !== port)) return { outcome: "foreign", pid: null };

  const server = record.serverPid;
  const serverCommand = commandOf(server);
  const serverIsOurs =
    server !== selfPid &&
    isAlive(server) &&
    isOwnProcess(serverCommand, { root }) &&
    commandUsesPort(serverCommand, port);
  if (!serverIsOurs) {
    removeRecord(path);
    const stillAlive = [record.pid, server].some((pid) => pid !== null && pid !== selfPid && isAlive(pid));
    return { outcome: stillAlive ? "foreign" : "stale-pidfile", pid: server };
  }

  // Parentage, not the launcher's command line, decides whether this server is stale:
  // a launcher may be invoked by a relative path or through a shim outside the install
  // root, but a dev server whose parent is still its recorded launcher is being
  // supervised, and one reparented to init is the orphan we came for.
  const supervised =
    record.pid !== null && record.pid !== server && record.pid !== selfPid && isAlive(record.pid) && parentOf(server) === record.pid;
  if (supervised) return { outcome: "live-instance", pid: server };

  for (const [signal, timeoutMs] of [
    ["SIGTERM", termTimeoutMs],
    ["SIGKILL", killTimeoutMs],
  ]) {
    try {
      kill(server, signal);
    } catch {
      // Already gone, or no longer ours to signal; the port check below decides.
    }
    if (await waitForPortFree(port, { isPortFree, timeoutMs, intervalMs: pollIntervalMs, wait })) {
      removeRecord(path);
      return { outcome: "reclaimed", pid: record.serverPid };
    }
  }
  return { outcome: "unreclaimed", pid: record.serverPid };
}

/**
 * Pidfile lifecycle for one launcher run: record the server once it is spawned, and
 * clear the record on the way out. `clear` is synchronous so it can run from an
 * `exit` handler, and is safe to call more than once.
 *
 * Neither half may ever fail a launch: a globally installed copy can sit in a directory
 * this user cannot write, and a launcher that refused to start over an unwritable
 * pidfile would be worse than one that simply cannot auto-heal later.
 */
export function createPidfileHandle({ root, port, ownerPid = process.pid, write = writePidfile, remove = removePidfile }) {
  const path = pidfilePath(root, port);
  let written = false;
  return {
    path,
    record(serverPid) {
      try {
        write(path, {
          pid: ownerPid,
          serverPid: serverPid ?? ownerPid,
          port,
          root,
          startedAt: new Date().toISOString(),
        });
        written = true;
      } catch {
        written = false;
      }
      return written;
    },
    clear() {
      if (!written) return;
      written = false;
      try {
        remove(path, { ownerPid });
      } catch {
        // Nothing to do on the way out; the next launch treats it as a stale record.
      }
    },
  };
}
