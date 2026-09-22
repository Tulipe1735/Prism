import { describe, expect, it } from "vitest";

import { parseBrowserUrl } from "../../src/browser/connect.ts";
import { parseArgs } from "../../src/interfaces/cli.ts";
import { ConfigError } from "../../src/shared/errors.ts";

describe("parseArgs", () => {
  it("defaults to a 60-action budget without step, record, or JSON", () => {
    expect(parseArgs([])).toEqual({
      maxSteps: 60,
      step: false,
      json: false,
      help: false,
      version: false,
    });
  });

  it("joins unquoted goal words after the URL", () => {
    const options = parseArgs([
      "https://example.com",
      "find",
      "the",
      "cheapest",
      "flight",
    ]);
    expect(options.url).toBe("https://example.com");
    expect(options.goal).toBe("find the cheapest flight");
  });

  it("accepts values with a space or an equals sign", () => {
    expect(
      parseArgs([
        "https://a.com",
        "goal",
        "--max-steps",
        "5",
        "--record=out",
        "--json",
      ]),
    ).toMatchObject({ maxSteps: 5, record: "out", json: true });
    expect(
      parseArgs(["https://a.com", "goal", "--browser-url", "http://127.0.0.1:9333"]),
    ).toMatchObject({ browserUrl: "http://127.0.0.1:9333" });
  });

  it("rejects invalid budgets and unknown flags", () => {
    expect(() => parseArgs(["https://a.com", "goal", "--max-steps", "0"])).toThrow(
      ConfigError,
    );
    expect(() => parseArgs(["https://a.com", "goal", "--max-steps"])).toThrow(
      ConfigError,
    );
    expect(() => parseArgs(["--nope"])).toThrow(ConfigError);
  });
});

describe("parseBrowserUrl", () => {
  it("extracts the host and port", () => {
    expect(parseBrowserUrl("http://127.0.0.1:9333")).toEqual({
      host: "127.0.0.1",
      port: 9333,
    });
  });

  it("rejects a malformed endpoint", () => {
    expect(() => parseBrowserUrl("not a url")).toThrow(/Invalid --browser-url/);
  });
});
