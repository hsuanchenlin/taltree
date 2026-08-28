import { describe, it, expect, afterEach } from "vitest";
import net from "node:net";
import http from "node:http";
import { isPortFree, findFreePort, waitForServer } from "./server.mjs";

const open = [];
afterEach(async () => {
  await Promise.all(open.splice(0).map((s) => new Promise((r) => s.close(r))));
});

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

describe("isPortFree / findFreePort", () => {
  it("reports a bound port as busy and a released one as free", async () => {
    const server = net.createServer();
    open.push(server);
    const port = await listen(server);
    expect(await isPortFree(port)).toBe(false);
    await new Promise((r) => server.close(r));
    open.pop();
    expect(await isPortFree(port)).toBe(true);
  });

  it("skips busy ports when finding a free one", async () => {
    const server = net.createServer();
    open.push(server);
    const busy = await listen(server);
    const found = await findFreePort(busy);
    expect(found).not.toBe(busy);
    expect(found).toBeGreaterThan(busy);
  });
});

describe("waitForServer", () => {
  it("resolves once the server answers", async () => {
    const server = http.createServer((req, res) => res.end("ok"));
    open.push(server);
    const port = await listen(server);
    await expect(waitForServer(`http://127.0.0.1:${port}`, { timeoutMs: 3000 })).resolves.toBeUndefined();
  });

  it("rejects after the timeout when nothing listens", async () => {
    await expect(waitForServer("http://127.0.0.1:1", { timeoutMs: 200, intervalMs: 50 })).rejects.toThrow(/timed out/);
  });
});
