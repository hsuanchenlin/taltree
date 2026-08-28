import { beforeEach, describe, expect, it } from "vitest";
import {
  clearDiagnosticEvents,
  describeError,
  DIAGNOSTIC_EVENT_LIMIT,
  diagnosticEvents,
  installDiagnosticErrorCapture,
  recordDiagnosticEvent,
} from "./errorLog";

describe("describeError", () => {
  it("keeps the name, message, and stack of a real error", () => {
    const described = describeError(new TypeError("bad texture"));
    expect(described.message).toBe("TypeError: bad texture");
    expect(described.stack).toContain("TypeError: bad texture");
  });

  it("passes a plain string through", () => {
    expect(describeError("WebGL context lost")).toEqual({
      message: "WebGL context lost",
    });
  });

  it("serialises anything else rather than losing it", () => {
    expect(describeError({ code: 7 }).message).toBe('{"code":7}');
    expect(describeError(undefined).message).toBe("undefined");
  });
});

describe("the diagnostic event ring buffer", () => {
  beforeEach(() => clearDiagnosticEvents());

  it("records the source and an ISO timestamp", () => {
    recordDiagnosticEvent("pixi.init", "boom", new Date("2026-08-28T09:00:00Z"));
    expect(diagnosticEvents()).toEqual([
      {
        at: "2026-08-28T09:00:00.000Z",
        source: "pixi.init",
        message: "boom",
      },
    ]);
  });

  it("keeps only the most recent events so a render loop cannot flood it", () => {
    for (let i = 0; i < DIAGNOSTIC_EVENT_LIMIT + 10; i += 1) {
      recordDiagnosticEvent("pixi.render", `failure ${i}`);
    }
    const events = diagnosticEvents();
    expect(events).toHaveLength(DIAGNOSTIC_EVENT_LIMIT);
    expect(events[events.length - 1]?.message).toBe(
      `failure ${DIAGNOSTIC_EVENT_LIMIT + 9}`,
    );
  });
});

describe("installDiagnosticErrorCapture", () => {
  beforeEach(() => clearDiagnosticEvents());

  it("captures page errors and rejections until it is uninstalled", () => {
    const listeners = new Map<string, EventListener>();
    const target = {
      addEventListener: (type: string, listener: EventListener) =>
        void listeners.set(type, listener),
      removeEventListener: (type: string) => void listeners.delete(type),
    } as unknown as Window;

    const uninstall = installDiagnosticErrorCapture(target);
    listeners.get("error")?.({ error: new Error("render failed") } as never);
    listeners.get("unhandledrejection")?.({ reason: "no WebGL" } as never);

    expect(diagnosticEvents().map((event) => event.source)).toEqual([
      "window.error",
      "unhandledrejection",
    ]);
    expect(diagnosticEvents()[1]?.message).toBe("no WebGL");

    uninstall();
    expect(listeners.size).toBe(0);
  });
});
