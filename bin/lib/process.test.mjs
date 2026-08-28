import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import net from "node:net";
import {
  pidfilePath,
  writePidfile,
  claimPidfile,
  readPidfile,
  removePidfile,
  isProcessAlive,
  readProcessCommand,
  isOwnProcess,
  reclaimPort,
  createPidfileHandle,
} from "./process.mjs";
import { isPortFree } from "./server.mjs";

let root;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "taltree-process-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** A pid high enough to be free on any sane machine, used as "already gone". */
const DEAD_PID = 4_194_303;

describe("pidfile", () => {
  it("round-trips a record and keeps one file per port", () => {
    const path = pidfilePath(root, 5173);
    expect(path).toBe(join(root, ".taltree", "server-5173.pid"));
    expect(pidfilePath(root, 5174)).not.toBe(path);

    writePidfile(path, { pid: 10, serverPid: 11, port: 5173, root, startedAt: "2026-08-28T00:00:00.000Z" });
    expect(readPidfile(path)).toEqual({
      pid: 10,
      serverPid: 11,
      port: 5173,
      root,
      startedAt: "2026-08-28T00:00:00.000Z",
    });
  });

  it("reads a missing, malformed, or pidless file as no record", () => {
    const path = pidfilePath(root, 5173);
    expect(readPidfile(path)).toBeNull();

    mkdirSync(join(root, ".taltree"), { recursive: true });
    writeFileSync(path, "not json at all");
    expect(readPidfile(path)).toBeNull();

    writeFileSync(path, JSON.stringify({ port: 5173, pid: "nonsense" }));
    expect(readPidfile(path)).toBeNull();
  });

  it("removes its own record and leaves another launcher's alone", () => {
    const path = pidfilePath(root, 5173);
    writePidfile(path, { pid: 10, serverPid: 11, port: 5173 });

    expect(removePidfile(path, { ownerPid: 99 })).toBe(false);
    expect(existsSync(path)).toBe(true);

    expect(removePidfile(path, { ownerPid: 10 })).toBe(true);
    expect(existsSync(path)).toBe(false);
    expect(removePidfile(path, { ownerPid: 10 })).toBe(false);
  });

  it("claims a pidfile exclusively", () => {
    const path = pidfilePath(root, 5173);
    expect(claimPidfile(path, { pid: 10, serverPid: 11, port: 5173 })).toBe(true);
    expect(claimPidfile(path, { pid: 20, serverPid: 21, port: 5173 })).toBe(false);
    expect(readPidfile(path)).toMatchObject({ pid: 10, serverPid: 11 });
  });

  it("takes over a stale pidfile for a free port", () => {
    const path = pidfilePath(root, 5173);
    writePidfile(path, { pid: DEAD_PID, serverPid: DEAD_PID, port: 5173 });

    expect(claimPidfile(path, { pid: 20, serverPid: 20, port: 5173 })).toBe(true);
    expect(readPidfile(path)).toMatchObject({ pid: 20, serverPid: 20 });
  });
});

describe("createPidfileHandle", () => {
  it("records the server on launch and removes the pidfile on clean shutdown", () => {
    const handle = createPidfileHandle({ root, port: 5173, ownerPid: 4242 });
    handle.record(4243);

    const record = readPidfile(handle.path);
    expect(record).toMatchObject({ pid: 4242, serverPid: 4243, port: 5173, root });
    expect(Date.parse(record.startedAt)).not.toBeNaN();

    handle.clear();
    expect(existsSync(handle.path)).toBe(false);
  });

  it("never fails a launch when the pidfile cannot be written", () => {
    const handle = createPidfileHandle({
      root,
      port: 5173,
      ownerPid: 4242,
      claim: () => {
        throw Object.assign(new Error("read-only file system"), { code: "EROFS" });
      },
    });
    expect(handle.record(4243)).toBe(false);
    expect(() => handle.clear()).not.toThrow();
    expect(existsSync(handle.path)).toBe(false);
  });

  it("clears at most once and never touches a record it did not write", () => {
    const handle = createPidfileHandle({ root, port: 5173, ownerPid: 4242 });
    handle.clear();
    expect(existsSync(handle.path)).toBe(false);

    handle.record(4243);
    handle.clear();
    // A later launcher's record must survive a stale clear() from this one.
    writePidfile(handle.path, { pid: 777, serverPid: 778, port: 5173 });
    handle.clear();
    expect(readPidfile(handle.path)).toMatchObject({ pid: 777 });
  });

  it("keeps the bind winner's record when a contender clears without claiming", () => {
    const winner = createPidfileHandle({ root, port: 5173, ownerPid: 4242 });
    const contender = createPidfileHandle({ root, port: 5173, ownerPid: 7777 });
    const nextPort = createPidfileHandle({ root, port: 5174, ownerPid: 7777 });
    expect(winner.claim()).toBe(true);
    winner.record(4243);

    expect(contender.claim()).toBe(false);
    contender.clear();
    expect(nextPort.claim()).toBe(true);

    expect(readPidfile(winner.path)).toMatchObject({ pid: 4242, serverPid: 4243 });
    expect(readPidfile(nextPort.path)).toMatchObject({ pid: 7777, port: 5174 });
  });
});

describe("isProcessAlive", () => {
  it("sees this process, and not a pid that is gone", () => {
    expect(isProcessAlive(process.pid)).toBe(true);
    expect(isProcessAlive(DEAD_PID)).toBe(false);
    expect(isProcessAlive(0)).toBe(false);
    expect(isProcessAlive(null)).toBe(false);
  });

  it("treats a permission error as alive", () => {
    const kill = () => {
      throw Object.assign(new Error("operation not permitted"), { code: "EPERM" });
    };
    expect(isProcessAlive(1, { kill })).toBe(true);
  });
});

describe("readProcessCommand", () => {
  it("reads this process's command line and reports nothing for a dead pid", () => {
    expect(readProcessCommand(process.pid)).toContain("node");
    expect(readProcessCommand(DEAD_PID)).toBeNull();
  });

  it("reports nothing when the lookup itself fails", () => {
    const run = () => {
      throw new Error("ps not found");
    };
    expect(readProcessCommand(process.pid, { run })).toBeNull();
    expect(readProcessCommand(process.pid, { run: () => "   " })).toBeNull();
  });
});

describe("isOwnProcess", () => {
  const installRoot = "/home/dev/taltree";

  it("recognises this installation's dev server and launcher", () => {
    const root = installRoot;
    expect(isOwnProcess(`node ${root}/node_modules/.bin/vite --port 5173 --strictPort`, { root })).toBe(true);
    expect(isOwnProcess(`node ${root}/bin/taltree.mjs`, { root })).toBe(true);
    expect(isOwnProcess(`node ${root}/node_modules/.bin/vite --port 5173`, { root: `${root}/` })).toBe(true);
  });

  it("recognises an installation whose path contains spaces", () => {
    const root = "/home/dev/My Projects/taltree";
    expect(isOwnProcess(`node ${root}/node_modules/.bin/vite --port 5173 --strictPort`, { root })).toBe(true);
  });

  it("refuses a different installation whose path ends with this root", () => {
    const root = installRoot;
    expect(isOwnProcess(`node /backup${root}/node_modules/.bin/vite --port 5173`, { root })).toBe(false);
  });

  it("uses platform path case semantics", () => {
    const command = "node /HOME/DEV/TALTREE/node_modules/.bin/VITE --port 5173";
    expect(isOwnProcess(command, { root: installRoot, platform: "linux" })).toBe(false);
    expect(isOwnProcess(command, { root: installRoot, platform: "darwin" })).toBe(true);
    expect(isOwnProcess(command, { root: installRoot, platform: "win32" })).toBe(true);
  });

  it("refuses anything it cannot positively identify", () => {
    const root = installRoot;
    expect(isOwnProcess("node /elsewhere/taltree/node_modules/.bin/vite --port 5173", { root })).toBe(false);
    // A program merely pointed at our checkout is not ours to kill.
    expect(isOwnProcess(`postgres -D ${root}/data`, { root })).toBe(false);
    expect(isOwnProcess(`node ${root}/scripts/vite.config.ts`, { root })).toBe(false);
    expect(isOwnProcess("node /somewhere/vite", {})).toBe(false);
    expect(isOwnProcess(null, { root })).toBe(false);
    expect(isOwnProcess("   ", { root })).toBe(false);
  });
});

/** reclaimPort with every side effect injected, so outcomes are deterministic. */
function harness({ portFree, record, alive = () => true, command = () => null, parent = () => 1 }) {
  const freeStates = Array.isArray(portFree) ? [...portFree] : null;
  const signals = [];
  const removed = [];
  return {
    signals,
    removed,
    run: (overrides = {}) =>
      reclaimPort({
        root: "/home/dev/taltree",
        port: 5173,
        isPortFree: async () => (freeStates ? (freeStates.length > 1 ? freeStates.shift() : freeStates[0]) : portFree),
        readRecord: () => record,
        removeRecord: (path) => removed.push(path),
        isAlive: alive,
        commandOf: command,
        parentOf: parent,
        kill: (pid, signal) => signals.push([pid, signal]),
        wait: async () => {},
        selfPid: 1,
        ...overrides,
      }),
  };
}

const PIDFILE = "/home/dev/taltree/.taltree/server-5173.pid";
/** Launcher 20 supervising dev server 21, the shape the launcher writes. */
const ownRecord = { pid: 20, serverPid: 21, port: 5173, root: "/home/dev/taltree", startedAt: null };
/** The orphan case: the launcher is gone, its dev server still holds the port. */
const orphaned = (pid) => pid === 21;
/** The live case: the dev server is still a child of its recorded launcher. */
const supervised = { alive: () => true, parent: () => 20 };
const viteCommand = "node /home/dev/taltree/node_modules/.bin/vite --port 5173 --strictPort";

describe("reclaimPort", () => {
  it("does nothing when the port is free", async () => {
    const h = harness({ portFree: true, record: ownRecord });
    expect(await h.run()).toEqual({ outcome: "free", pid: null });
    expect(h.signals).toEqual([]);
  });

  it("leaves a busy port alone when no pidfile claims it", async () => {
    const h = harness({ portFree: false, record: null });
    expect(await h.run()).toEqual({ outcome: "foreign", pid: null });
    expect(h.signals).toEqual([]);
    expect(h.removed).toEqual([]);
  });

  it("never signals an unrelated program that happens to hold the port", async () => {
    const h = harness({
      portFree: false,
      record: ownRecord,
      alive: () => true,
      command: () => "/usr/local/bin/postgres -D /var/lib/postgres",
    });
    expect(await h.run()).toEqual({ outcome: "foreign", pid: 21 });
    expect(h.signals).toEqual([]);
    expect(h.removed).toEqual([PIDFILE]);
  });

  it("cleans up a pidfile whose processes are already gone", async () => {
    const h = harness({ portFree: false, record: ownRecord, alive: () => false });
    expect(await h.run()).toEqual({ outcome: "stale-pidfile", pid: 21 });
    expect(h.signals).toEqual([]);
    expect(h.removed).toEqual([PIDFILE]);
  });

  it("leaves a running instance whose launcher is still supervising it", async () => {
    const h = harness({ portFree: false, record: ownRecord, command: () => viteCommand, ...supervised });
    expect(await h.run()).toEqual({ outcome: "live-instance", pid: 21 });
    expect(h.signals).toEqual([]);
    expect(h.removed).toEqual([]);
  });

  it("reclaims a server reparented away from a launcher pid that has been reused", async () => {
    const h = harness({ portFree: [false, true], record: ownRecord, alive: () => true, command: () => viteCommand });
    expect(await h.run()).toEqual({ outcome: "reclaimed", pid: 21 });
    expect(h.signals).toEqual([[21, "SIGTERM"]]);
  });

  it("ignores a record written for a different port", async () => {
    const h = harness({ portFree: false, record: { ...ownRecord, port: 5174 }, command: () => viteCommand });
    expect(await h.run()).toEqual({ outcome: "foreign", pid: null });
    expect(h.signals).toEqual([]);
  });

  it("never signals this installation's server when it was launched for another port", async () => {
    const otherPortCommand = "node /home/dev/taltree/node_modules/.bin/vite --port 5174 --strictPort";
    const h = harness({ portFree: false, record: ownRecord, alive: orphaned, command: () => otherPortCommand });
    expect(await h.run()).toEqual({ outcome: "foreign", pid: 21 });
    expect(h.signals).toEqual([]);
  });

  it("never signals a reused pid now running this installation's launcher", async () => {
    const launcherCommand = "node /home/dev/taltree/bin/taltree.mjs --port 5173";
    const h = harness({ portFree: false, record: ownRecord, alive: orphaned, command: () => launcherCommand });
    expect(await h.run()).toEqual({ outcome: "foreign", pid: 21 });
    expect(h.signals).toEqual([]);
  });

  it("never signals its own pid", async () => {
    const h = harness({ portFree: false, record: { pid: 7, serverPid: 7, port: 5173 }, command: () => viteCommand });
    expect(await h.run({ selfPid: 7 })).toEqual({ outcome: "stale-pidfile", pid: 7 });
    expect(h.signals).toEqual([]);
  });

  it("terminates an orphaned dev server with SIGTERM and reports the reclaim", async () => {
    const h = harness({ portFree: [false, true], record: ownRecord, alive: orphaned, command: () => viteCommand });
    expect(await h.run()).toEqual({ outcome: "reclaimed", pid: 21 });
    expect(h.signals).toEqual([[21, "SIGTERM"]]);
    expect(h.removed).toEqual([PIDFILE]);
  });

  it("escalates to SIGKILL when SIGTERM is ignored", async () => {
    let freed = false;
    const h = harness({ portFree: false, record: ownRecord, alive: orphaned, command: () => viteCommand });
    const result = await h.run({
      isPortFree: async () => freed,
      kill: (pid, signal) => {
        h.signals.push([pid, signal]);
        if (signal === "SIGKILL") freed = true;
      },
      termTimeoutMs: 0,
    });
    expect(result).toEqual({ outcome: "reclaimed", pid: 21 });
    expect(h.signals).toEqual([
      [21, "SIGTERM"],
      [21, "SIGKILL"],
    ]);
  });

  it("reports an unreclaimable port instead of pretending it is free", async () => {
    const h = harness({ portFree: false, record: ownRecord, alive: orphaned, command: () => viteCommand });
    const result = await h.run({ termTimeoutMs: 0, killTimeoutMs: 0 });
    expect(result).toEqual({ outcome: "unreclaimed", pid: 21 });
    expect(h.removed).toEqual([]);
  });

  it("survives a kill that throws because the process died mid-flight", async () => {
    const h = harness({ portFree: [false, true], record: ownRecord, alive: orphaned, command: () => viteCommand });
    const result = await h.run({
      kill: () => {
        throw Object.assign(new Error("no such process"), { code: "ESRCH" });
      },
    });
    expect(result).toEqual({ outcome: "reclaimed", pid: 21 });
  });
});

describe("reclaimPort against real processes", () => {
  const children = [];
  afterEach(() => {
    for (const pid of children.splice(0)) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // Already gone.
      }
    }
  });

  /** A stand-in for the dev server: a `vite` under the install root that holds a port. */
  function writeFakeVite({ ignoreSigterm = false } = {}) {
    const binDir = join(root, "node_modules", ".bin");
    mkdirSync(binDir, { recursive: true });
    const script = join(binDir, "vite");
    writeFileSync(
      script,
      [
        "const net = require('node:net');",
        ignoreSigterm ? "process.on('SIGTERM', () => {});" : "",
        "const server = net.createServer();",
        "const port = Number(process.argv[process.argv.indexOf('--port') + 1]);",
        "server.listen({ port, host: '127.0.0.1' }, () => console.log('listening'));",
      ].join("\n"),
    );
    return script;
  }

  async function freePort() {
    const probe = net.createServer();
    const port = await new Promise((resolve) => probe.listen(0, "127.0.0.1", () => resolve(probe.address().port)));
    await new Promise((resolve) => probe.close(resolve));
    return port;
  }

  /** Wait for the first line a child prints, so the port is really bound before we act. */
  function firstLine(child) {
    return new Promise((resolve, reject) => {
      child.stdout.once("data", (chunk) => resolve(String(chunk).trim()));
      child.once("exit", () => reject(new Error("child exited before printing")));
    });
  }

  /** The orphan: a dev server whose launcher is gone, still holding its port. */
  async function spawnOrphan({ ignoreSigterm = false } = {}) {
    const script = writeFakeVite({ ignoreSigterm });
    const port = await freePort();
    const child = spawn(process.execPath, [script, "--port", String(port)], { stdio: ["ignore", "pipe", "inherit"] });
    children.push(child.pid);
    await firstLine(child);
    return { pid: child.pid, port };
  }

  /** The live instance: a launcher process still supervising the dev server it spawned. */
  async function spawnSupervisedServer() {
    const script = writeFakeVite();
    const port = await freePort();
    const launcherScript = join(root, "launcher.js");
    writeFileSync(
      launcherScript,
      [
        "const { spawn } = require('node:child_process');",
        `const child = spawn(process.execPath, [${JSON.stringify(script)}, '--port', String(${port})], { stdio: ['ignore', 'pipe', 'inherit'] });`,
        "child.stdout.on('data', () => console.log(child.pid));",
        "setInterval(() => {}, 1000);",
      ].join("\n"),
    );
    const launcher = spawn(process.execPath, [launcherScript], { stdio: ["ignore", "pipe", "inherit"] });
    children.push(launcher.pid);
    const serverPid = Number(await firstLine(launcher));
    children.push(serverPid);
    return { launcherPid: launcher.pid, serverPid, port };
  }

  it("terminates the orphan, frees the port, and removes the pidfile", async () => {
    const { pid, port } = await spawnOrphan();
    const path = pidfilePath(root, port);
    // pid: the launcher that spawned it, long gone - the shape a killed launcher leaves.
    writePidfile(path, { pid: DEAD_PID, serverPid: pid, port, root });
    expect(await isPortFree(port)).toBe(false);

    const result = await reclaimPort({ root, port, isPortFree });
    expect(result).toEqual({ outcome: "reclaimed", pid });
    expect(await isPortFree(port)).toBe(true);
    expect(existsSync(path)).toBe(false);
    expect(isProcessAlive(pid)).toBe(false);
  });

  it("escalates to SIGKILL when the orphan ignores SIGTERM", async () => {
    const { pid, port } = await spawnOrphan({ ignoreSigterm: true });
    writePidfile(pidfilePath(root, port), { pid: DEAD_PID, serverPid: pid, port, root });

    const result = await reclaimPort({ root, port, isPortFree, termTimeoutMs: 200 });
    expect(result).toEqual({ outcome: "reclaimed", pid });
    expect(await isPortFree(port)).toBe(true);
  });

  it("leaves a live instance alone while its launcher still supervises the server", async () => {
    const { launcherPid, serverPid, port } = await spawnSupervisedServer();
    writePidfile(pidfilePath(root, port), { pid: launcherPid, serverPid, port, root });

    const result = await reclaimPort({ root, port, isPortFree });
    expect(result).toEqual({ outcome: "live-instance", pid: serverPid });
    expect(isProcessAlive(serverPid)).toBe(true);
    expect(await isPortFree(port)).toBe(false);
  });

  it("leaves a live process alone when the pidfile points at a foreign program", async () => {
    const { pid, port } = await spawnOrphan();
    // A recycled pid: the record is ours, the process now holding it is not.
    writePidfile(pidfilePath(root, port), { pid: DEAD_PID, serverPid: pid, port, root });

    const result = await reclaimPort({ root, port, isPortFree, commandOf: () => "/usr/bin/redis-server *:6379" });
    expect(result).toEqual({ outcome: "foreign", pid });
    expect(isProcessAlive(pid)).toBe(true);
    expect(await isPortFree(port)).toBe(false);
  });
});
