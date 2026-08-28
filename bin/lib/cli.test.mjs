import { describe, it, expect } from "vitest";
import { parseArgs, helpText, CliError, DEFAULT_PORT } from "./cli.mjs";

describe("parseArgs", () => {
  it("defaults to run on the default port", () => {
    expect(parseArgs([])).toEqual({ command: "run", port: DEFAULT_PORT, portExplicit: false, check: false, open: true });
    expect(parseArgs(["run"])).toEqual({ command: "run", port: DEFAULT_PORT, portExplicit: false, check: false, open: true });
  });

  it("accepts --no-open for run only", () => {
    expect(parseArgs(["--no-open"])).toMatchObject({ command: "run", open: false });
    expect(() => parseArgs(["update", "--no-open"])).toThrow(CliError);
  });

  it("accepts --port as separate or inline value", () => {
    expect(parseArgs(["--port", "8080"])).toMatchObject({ command: "run", port: 8080, portExplicit: true });
    expect(parseArgs(["run", "--port=9000"])).toMatchObject({ command: "run", port: 9000, portExplicit: true });
  });

  it("parses the update command and --check", () => {
    expect(parseArgs(["update"])).toEqual({ command: "update", port: DEFAULT_PORT, portExplicit: false, check: false, open: true });
    expect(parseArgs(["update", "--check"])).toMatchObject({ command: "update", check: true });
  });

  it("parses help via flag or command", () => {
    expect(parseArgs(["--help"]).command).toBe("help");
    expect(parseArgs(["-h"]).command).toBe("help");
    expect(parseArgs(["help"]).command).toBe("help");
    expect(parseArgs(["run", "--help"]).command).toBe("help");
  });

  it("rejects invalid ports", () => {
    for (const args of [["--port"], ["--port", "abc"], ["--port", "0"], ["--port", "70000"], ["--port", "-1"], ["--port="]]) {
      expect(() => parseArgs(args)).toThrow(CliError);
    }
  });

  it("rejects misplaced options", () => {
    expect(() => parseArgs(["update", "--port", "3000"])).toThrow(CliError);
    expect(() => parseArgs(["--check"])).toThrow(CliError);
    expect(() => parseArgs(["run", "--check"])).toThrow(CliError);
  });

  it("rejects unknown commands, options, and stray arguments", () => {
    expect(() => parseArgs(["bogus"])).toThrow(CliError);
    expect(() => parseArgs(["--bogus"])).toThrow(CliError);
    expect(() => parseArgs(["update", "extra"])).toThrow(CliError);
  });
});

describe("helpText", () => {
  it("documents run, update, --check, and --port", () => {
    const text = helpText();
    expect(text).toContain("taltree update");
    expect(text).toContain("--check");
    expect(text).toContain("--port");
    expect(text).toContain(String(DEFAULT_PORT));
  });
});
