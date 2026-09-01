import { describe, it, expect } from "vitest";
import { parseArgs, helpText, CliError, DEFAULT_PORT } from "./cli.mjs";

const tui = (overrides = {}) => ({
  command: "tui",
  port: DEFAULT_PORT,
  portExplicit: false,
  open: true,
  check: false,
  tuiArgs: [],
  ...overrides,
});

describe("parseArgs", () => {
  it("defaults to the terminal application with no arguments", () => {
    expect(parseArgs([])).toEqual(tui());
    expect(parseArgs(["run"])).toEqual(tui());
  });

  it("passes a plan path and unrecognised options to the terminal application", () => {
    expect(parseArgs(["plans/today.yaml"])).toEqual(tui({ tuiArgs: ["plans/today.yaml"] }));
    expect(parseArgs(["-e"])).toEqual(tui({ tuiArgs: ["-e"] }));
    expect(parseArgs(["--date", "2026-08-31", "tree.yaml"])).toEqual(
      tui({ tuiArgs: ["--date", "2026-08-31", "tree.yaml"] }),
    );
    // The Rust command line is the authority on its own options, so a typo travels
    // there to be reported rather than being second-guessed here.
    expect(parseArgs(["--bogus"])).toEqual(tui({ tuiArgs: ["--bogus"] }));
  });

  it("forwards everything after -- verbatim", () => {
    expect(parseArgs(["--", "--help"])).toEqual(tui({ tuiArgs: ["--help"] }));
    expect(parseArgs(["--", "update", "--web"])).toEqual(tui({ tuiArgs: ["update", "--web"] }));
  });

  it("selects the web build only with --web", () => {
    expect(parseArgs(["--web"])).toEqual({
      command: "web",
      port: DEFAULT_PORT,
      portExplicit: false,
      open: true,
      check: false,
      tuiArgs: [],
    });
    expect(parseArgs(["run", "--web", "--no-open"])).toMatchObject({ command: "web", open: false });
  });

  it("accepts --port as separate or inline value, with --web", () => {
    expect(parseArgs(["--web", "--port", "8080"])).toMatchObject({ command: "web", port: 8080, portExplicit: true });
    expect(parseArgs(["run", "--port=9000", "--web"])).toMatchObject({ command: "web", port: 9000, portExplicit: true });
  });

  it("refuses web-only options without --web", () => {
    expect(() => parseArgs(["--port", "8080"])).toThrow(CliError);
    expect(() => parseArgs(["--no-open"])).toThrow(CliError);
  });

  it("refuses a plan file alongside --web", () => {
    expect(() => parseArgs(["--web", "tree.yaml"])).toThrow(CliError);
    expect(() => parseArgs(["tree.yaml", "--web"])).toThrow(CliError);
  });

  it("parses the update command and --check", () => {
    expect(parseArgs(["update"])).toEqual({
      command: "update",
      port: DEFAULT_PORT,
      portExplicit: false,
      open: true,
      check: false,
      tuiArgs: [],
    });
    expect(parseArgs(["update", "--check"])).toMatchObject({ command: "update", check: true });
  });

  it("parses help via flag or command", () => {
    expect(parseArgs(["--help"]).command).toBe("help");
    expect(parseArgs(["-h"]).command).toBe("help");
    expect(parseArgs(["help"]).command).toBe("help");
    expect(parseArgs(["run", "--help"]).command).toBe("help");
    expect(parseArgs(["--web", "--help"]).command).toBe("help");
  });

  it("rejects invalid ports", () => {
    for (const value of ["", "abc", "0", "70000", "-1"]) {
      expect(() => parseArgs(["--web", "--port", value])).toThrow(CliError);
    }
    expect(() => parseArgs(["--web", "--port"])).toThrow(CliError);
    expect(() => parseArgs(["--web", "--port="])).toThrow(CliError);
  });

  it("rejects misplaced options and stray update arguments", () => {
    expect(() => parseArgs(["update", "--port", "3000"])).toThrow(CliError);
    expect(() => parseArgs(["update", "--web"])).toThrow(CliError);
    expect(() => parseArgs(["update", "--no-open"])).toThrow(CliError);
    expect(() => parseArgs(["update", "--"])).toThrow(CliError);
    expect(() => parseArgs(["--check"])).toThrow(CliError);
    expect(() => parseArgs(["run", "--check"])).toThrow(CliError);
    expect(() => parseArgs(["update", "extra"])).toThrow(CliError);
  });
});

describe("helpText", () => {
  it("documents the terminal default, --web, update, --check, and --port", () => {
    const text = helpText();
    expect(text).toContain("terminal application");
    expect(text).toContain("--web");
    expect(text).toContain("taltree update");
    expect(text).toContain("--check");
    expect(text).toContain("--port");
    expect(text).toContain(String(DEFAULT_PORT));
  });
});
