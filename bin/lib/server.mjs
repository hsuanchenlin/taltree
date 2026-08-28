// Dev-server launch helpers: free-port discovery, readiness polling, browser opening.

import net from "node:net";
import http from "node:http";
import { spawn } from "node:child_process";

/** Host the dev server binds to; probes and readiness checks use the same one. */
export const SERVER_HOST = "127.0.0.1";

/** True when `err` means the address family simply does not exist on this machine. */
function familyUnavailable(err) {
  return err.code === "EAFNOSUPPORT" || err.code === "EADDRNOTAVAIL";
}

function canBind(port, host, { ipv6Only = false } = {}) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", (err) => resolve(familyUnavailable(err)));
    probe.once("listening", () => probe.close(() => resolve(true)));
    probe.listen({ port, host, ipv6Only });
  });
}

/**
 * True when `port` can be taken on every interface the dev server or the
 * readiness probe could touch. Without an explicit `host`, both loopbacks
 * and both wildcards are probed: 127.0.0.1 and 0.0.0.0 (which also covers
 * dual-stack `::` listeners) plus the IPv6-only `::1` and `::`. BSD-style
 * stacks let a wildcard bind coexist with a specific address on the same
 * port, so probing only the wildcards would miss loopback-only listeners.
 */
export async function isPortFree(port, host) {
  if (host) return canBind(port, host);
  for (const [probeHost, options] of [
    ["127.0.0.1"],
    ["0.0.0.0"],
    ["::1", { ipv6Only: true }],
    ["::", { ipv6Only: true }],
  ]) {
    if (!(await canBind(port, probeHost, options))) return false;
  }
  return true;
}

/** First free port at or above `preferred`. Throws if none within maxAttempts. */
export async function findFreePort(preferred, { maxAttempts = 100 } = {}) {
  for (let port = preferred; port < preferred + maxAttempts && port <= 65535; port++) {
    if (await isPortFree(port)) return port;
  }
  throw new Error(`no free port found in range ${preferred}-${Math.min(preferred + maxAttempts - 1, 65535)}`);
}

/** Poll `url` until it answers or the deadline passes. */
export function waitForServer(url, { timeoutMs = 15000, intervalMs = 150 } = {}) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve();
      });
      req.on("error", () => {
        if (Date.now() >= deadline) reject(new Error(`timed out waiting for ${url}`));
        else setTimeout(attempt, intervalMs);
      });
    };
    attempt();
  });
}

/** True when collected server output reports a port bind failure. */
export function isPortInUseError(output) {
  return /already in use|EADDRINUSE/i.test(output);
}

/**
 * Spawn the Vite dev server bound to `host:port`, mirroring its stderr while
 * collecting it for bind-failure detection. `waitUntilReady(url)` resolves
 * once the server answers, exits, or the readiness deadline passes.
 */
export function spawnDevServer(viteBin, { cwd, port, host = SERVER_HOST, timeoutMs = 15000 }) {
  const outputTailSize = 4096;
  const child = spawn(viteBin, ["--port", String(port), "--strictPort", "--host", host], {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  let stdout = "";
  let readyAnnounced = false;
  let announceReady;
  const announced = new Promise((resolve) => {
    announceReady = resolve;
  });
  const expectedUrl = `http://${host}:${port}/`;
  child.stdout.on("data", (chunk) => {
    process.stdout.write(chunk);
    if (readyAnnounced) return;
    stdout = (stdout + chunk).slice(-outputTailSize);
    const plainOutput = stdout.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");
    if (plainOutput.includes("Local:") && plainOutput.includes(expectedUrl)) {
      readyAnnounced = true;
      stdout = "";
      announceReady();
    }
  });
  child.stderr.on("data", (chunk) => {
    stderr = (stderr + chunk).slice(-outputTailSize);
    process.stderr.write(chunk);
  });
  const exited = new Promise((resolve) => child.once("exit", (code) => resolve(code)));
  return {
    child,
    exited,
    get stderr() {
      return stderr;
    },
    waitUntilReady(url) {
      let timeout;
      const timedOut = new Promise((resolve) => {
        timeout = setTimeout(
          () => resolve({ ready: false, timedOut: true, error: new Error(`timed out waiting for ${url}`) }),
          timeoutMs,
        );
      });
      const result = Promise.race([
        announced.then(() => waitForServer(url, { timeoutMs })).then(
          () => ({ ready: true }),
          (err) => ({ ready: false, timedOut: true, error: err }),
        ),
        exited.then((code) => ({ ready: false, timedOut: false, code })),
        timedOut,
      ]);
      return result.finally(() => clearTimeout(timeout));
    },
  };
}

/** Open `url` in the default browser, detached and best-effort. */
export function openBrowser(url) {
  const [cmd, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
  child.on("error", () => {});
  child.unref();
}
