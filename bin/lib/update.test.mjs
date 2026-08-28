import { describe, it, expect } from "vitest";
import { describeStatus } from "./update.mjs";

describe("describeStatus", () => {
  it("reports up to date when nothing is behind", () => {
    expect(describeStatus({ ahead: 0, behind: 0, current: "aaa1111", incoming: "aaa1111" })).toBe(
      "Already up to date (aaa1111).",
    );
  });

  it("notes unpushed local commits without claiming an update", () => {
    expect(describeStatus({ ahead: 2, behind: 0, current: "aaa1111", incoming: "aaa1111" })).toContain(
      "2 local commit(s) not yet pushed",
    );
  });

  it("announces available updates with before and after commits", () => {
    const line = describeStatus({ ahead: 0, behind: 3, current: "aaa1111", incoming: "bbb2222" });
    expect(line).toContain("3 new commit(s)");
    expect(line).toContain("aaa1111 -> bbb2222");
  });
});
