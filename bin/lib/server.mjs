// Dev-server launch helpers: free-port discovery, readiness polling, browser opening.

import net from "node:net";
import http from "node:http";
import { spawn } from "node:child_process";

export function isPortFree(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.once("listening", () => probe.close(() => resolve(true)));
    probe.listen(port, host);
  });
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
