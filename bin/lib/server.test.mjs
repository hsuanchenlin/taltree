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

/** Bind a throwaway server on `host`; null when the address family is unavailable. */
async function tryListen(host, { ipv6Only = false } = {}) {
  const server = net.createServer();
  try {
    const port = await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen({ port: 0, host, ipv6Only }, () => resolve(server.address().port));
    });
    open.push(server);
    return port;
  } catch {
    return null;
  }
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

describe("isPortFree across address families", () => {
  it("detects a port bound on the IPv4 wildcard (0.0.0.0)", async () => {
    const port = await tryListen("0.0.0.0");
    expect(port).not.toBeNull();
    expect(await isPortFree(port)).toBe(false);
  });

  it("detects a port bound on IPv6 loopback (::1)", async (ctx) => {
    const port = await tryListen("::1", { ipv6Only: true });
    if (port === null) return ctx.skip();
    expect(await isPortFree(port)).toBe(false);
  });

  it("detects a port bound on the IPv6 wildcard (::)", async (ctx) => {
    const port = await tryListen("::", { ipv6Only: true });
    if (port === null) return ctx.skip();
    expect(await isPortFree(port)).toBe(false);
  });

  it("detects a port bound on the dual-stack wildcard (::)", async (ctx) => {
    const port = await tryListen("::");
    if (port === null) return ctx.skip();
    expect(await isPortFree(port)).toBe(false);
  });

  it("reports an unbound port as free on both families", async () => {
    const server = net.createServer();
    const port = await listen(server);
    await new Promise((r) => server.close(r));
    expect(await isPortFree(port)).toBe(true);
  });

  it("findFreePort skips a port that is busy only on IPv6", async (ctx) => {
    const busy = await tryListen("::1", { ipv6Only: true });
    if (busy === null) return ctx.skip();
    expect(await findFreePort(busy)).toBeGreaterThan(busy);
  });

  it("still probes a single explicit host when one is given", async () => {
    const server = net.createServer();
    open.push(server);
    const port = await listen(server);
    expect(await isPortFree(port, "127.0.0.1")).toBe(false);
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
