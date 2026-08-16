import process from "node:process";

import { afterEach, describe, expect, it } from "vitest";

import { getConfiguredWorkspace, isConfiguredWorkspace } from "./workspace-policy";

const previousWorkspacePath = process.env.PRISM_WORKSPACE_PATH;

afterEach(() => {
  if (previousWorkspacePath === undefined) delete process.env.PRISM_WORKSPACE_PATH;
  else process.env.PRISM_WORKSPACE_PATH = previousWorkspacePath;
});

describe("workspace policy", () => {
  it("accepts a Windows workspace path containing spaces across slash and case changes", () => {
    process.env.PRISM_WORKSPACE_PATH = "C:\\Users\\Jane Doe\\Prism Project";

    expect(getConfiguredWorkspace()).toEqual({
      kind: "local",
      path: "C:\\Users\\Jane Doe\\Prism Project",
      displayName: "Prism Project",
    });
    expect(
      isConfiguredWorkspace({
        kind: "local",
        path: "c:/users/jane doe/prism project/",
        displayName: "ignored",
      }),
    ).toBe(true);
  });
});
