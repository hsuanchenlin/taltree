import type { DiagnosticEvent } from "./types";

/**
 * A small ring buffer of failures, so a black board can be explained after the
 * fact instead of only while a console is open. Errors reach it from the page's
 * global handlers and from the renderer's own failure paths.
 */

export const DIAGNOSTIC_EVENT_LIMIT = 25;

let events: DiagnosticEvent[] = [];

/** Message and stack for anything a `catch` or a rejection can hand over. */
export function describeError(reason: unknown): {
  message: string;
  stack?: string;
} {
  if (reason instanceof Error) {
    return reason.stack
      ? { message: `${reason.name}: ${reason.message}`, stack: reason.stack }
      : { message: `${reason.name}: ${reason.message}` };
  }
  if (typeof reason === "string") return { message: reason };
  try {
    return { message: JSON.stringify(reason) ?? String(reason) };
  } catch {
    return { message: String(reason) };
  }
}

export function recordDiagnosticEvent(
  source: string,
  reason: unknown,
  at: Date = new Date(),
): DiagnosticEvent {
  const event: DiagnosticEvent = {
    at: at.toISOString(),
    source,
    ...describeError(reason),
  };
  events = [...events, event].slice(-DIAGNOSTIC_EVENT_LIMIT);
  return event;
}

export function diagnosticEvents(): readonly DiagnosticEvent[] {
  return events;
}

export function clearDiagnosticEvents(): void {
  events = [];
}

/**
 * Capture page-global failures for the diagnostics panel. Returns the
 * uninstaller. Capturing never swallows anything: the console keeps its copy.
 */
export function installDiagnosticErrorCapture(
  target: Pick<Window, "addEventListener" | "removeEventListener">,
): () => void {
  const onError = (event: Event) => {
    const error = event as ErrorEvent;
    recordDiagnosticEvent("window.error", error.error ?? error.message ?? event);
  };
  const onRejection = (event: Event) => {
    const rejection = event as PromiseRejectionEvent;
    recordDiagnosticEvent("unhandledrejection", rejection.reason ?? event);
  };
  target.addEventListener("error", onError);
  target.addEventListener("unhandledrejection", onRejection);
  return () => {
    target.removeEventListener("error", onError);
    target.removeEventListener("unhandledrejection", onRejection);
  };
}
