import { describe, expect, it } from "vitest";
import { parseArgs } from "../../src/interfaces/cli.ts";

describe("browser CLI parsing", () => {
  it("offers layered help without model setup", () => {
    expect(parseArgs([]).help).toContain("external agent");
    expect(parseArgs(["act", "--help"]).help).toContain("--evidence");
    expect(parseArgs(["--version"]).version).toBe(true);
  });
  it("parses observations and explicit empty fill values", () => {
    expect(parseArgs(["observe", "--session", "s_1"]).command).toEqual({
      command: "observe",
      session: "s_1",
      scope: "local",
    });
    expect(
      parseArgs([
        "act",
        "--session=s_1",
        "--observation",
        "o_1",
        "--target",
        "o_1:e1",
        "--evidence",
        "v_1",
        "--operation",
        "fill",
        "--value=",
        "--request-id",
        "r1",
      ]).command,
    ).toMatchObject({ command: "act", value: "", request_id: "r1" });
  });
  it("rejects obsolete goal routes, mixed stdin flags and duplicate options", () => {
    for (const args of [
      ["https://example.com", "do something"],
      ["act", "--stdin", "--session=s"],
      ["observe", "--session=s", "--session=t"],
      ["observe", "--session=s", "--url=https://example.com"],
      ["observe", "--session=s", "--scope=adaptive"],
    ])
      expect(() => parseArgs(args)).toThrow();
    expect(parseArgs(["act", "--stdin", "--json"]).stdin).toBe(true);
  });
});
